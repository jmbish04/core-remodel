#!/usr/bin/env node
/**
 * Branch Impact Diagram Generator (AI-Powered)
 * ============================================
 *
 * Extracts structural and code diffs between the current branch and main,
 * calls Gemini via the Cloudflare AI Gateway to generate a Mermaid diagram
 * of the impact (Architecture or Flowchart), and validates the output.
 * Supports a self-correcting retry loop up to 3 times.
 *
 * Usage:
 *   node branch-impact.mjs [options]
 *
 * Options:
 *   --base <ref>    Base branch to diff against (default: main)
 *   --dry-run       Print prompt and exit without calling AI
 *   --output <path> Path to write output diagram markdown
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Custom zero-dependency .env loader
 */
function loadEnv() {
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim().replace(/^['"](.*)['"]$/, '$1');
        if (value && !process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}

/**
 * Get git diff statistics and file details
 */
function getGitDiff(baseRef) {
  const execOptions = { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }; // 10MB buffer to prevent ENOBUFS
  try {
    // 1. Get changed files
    const files = execSync(`git diff ${baseRef}...HEAD --name-only`, execOptions)
      .trim()
      .split('\n')
      .filter(Boolean);

    if (files.length === 0) {
      return null;
    }

    // 2. Get diff stat summary
    const stat = execSync(`git diff ${baseRef}...HEAD --stat`, execOptions).trim();

    // 3. Get focused content diff for schemas, routes, and services
    let codeDiff = '';
    try {
      // Exclude generated Drizzle meta snapshots (huge JSON that drowns the
      // 20k-char budget and gives the model no real signal). Keep migration
      // .sql + source.
      codeDiff = execSync(
        `git diff ${baseRef}...HEAD -- "src/backend/" "drizzle/" "scripts/" ":(exclude)drizzle/meta/**"`,
        execOptions
      ).trim();
    } catch (diffErr) {
      // If the path doesn't exist or git fails, proceed with empty diff
      codeDiff = '';
    }

    // Truncate code diff if it's too large for prompt context
    const maxChars = 20000;
    if (codeDiff.length > maxChars) {
      codeDiff = codeDiff.slice(0, maxChars) + '\n\n... [Diff truncated due to size] ...';
    }

    return { files, stat, codeDiff };
  } catch (err) {
    console.error(`❌ Failed to extract git diff: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Retrieve secret values from local tokens CLI if not set in environment
 */
function getSecretFromTokens(name) {
  try {
    return execSync(`tokens show ${name} --value-only`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();
  } catch (err) {
    return null;
  }
}

/**
 * Call Gemini API using @google/genai through Cloudflare AI Gateway
 */
async function callGemini(prompt, previousResponse = null, validationError = null, gatewayId = 'default-gateway') {
  const apiKey = process.env.GEMINI_API_KEY || getSecretFromTokens('GEMINI_API_KEY');
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || getSecretFromTokens('CLOUDFLARE_ACCOUNT_ID');
  
  // Precedence: explicit CLI param -> env var -> 'default-gateway'
  const resolvedGatewayId = gatewayId || process.env.AI_GATEWAY_ID || process.env.CF_GATEWAY_ID || 'default-gateway';
  const gatewayToken = process.env.CLOUDFLARE_AI_GATEWAY_TOKEN || getSecretFromTokens('CLOUDFLARE_AI_GATEWAY_TOKEN');

  if (!apiKey || !accountId) {
    console.error('❌ Error: GEMINI_API_KEY and CLOUDFLARE_ACCOUNT_ID must be configured in environment, .env file, or via tokens CLI.');
    process.exit(1);
  }

  const httpOptions = {
    baseUrl: `https://gateway.ai.cloudflare.com/v1/${accountId}/${resolvedGatewayId}/google-ai-studio`
  };

  if (gatewayToken) {
    httpOptions.headers = {
      'cf-aig-authorization': `Bearer ${gatewayToken}`
    };
  }
  
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions
  });

  const contents = [];

  // Feed previous failure context to AI for self-correction
  if (previousResponse && validationError) {
    contents.push({
      role: 'user',
      parts: [{ text: prompt }]
    });
    contents.push({
      role: 'model',
      parts: [{ text: previousResponse }]
    });
    contents.push({
      role: 'user',
      parts: [{
        text: `The diagram you generated had syntax errors. Please fix them.\n\nError details:\n${validationError}\n\nOutput only the corrected raw Mermaid diagram block.`
      }]
    });
  } else {
    contents.push({
      role: 'user',
      parts: [{ text: prompt }]
    });
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents
    });
    return response.text;
  } catch (err) {
    console.error(`❌ Gemini API call failed: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Extract clean Mermaid block from AI response text
 */
function extractMermaidBlock(text) {
  const match = text.match(/```mermaid\s*\n([\s\S]*?)\n```/);
  if (match) {
    return match[1].trim();
  }
  // Try fallback match without markdown fence
  const lines = text.split('\n').map(l => l.trim());
  const startIdx = lines.findIndex(l => l.startsWith('architecture-beta') || l.startsWith('flowchart') || l.startsWith('graph'));
  if (startIdx !== -1) {
    return lines.slice(startIdx).join('\n').trim();
  }
  return text.trim();
}

/**
 * Validate diagram syntax using validate.mjs
 */
function validateDiagram(code, tempFilePath) {
  fs.writeFileSync(tempFilePath, `\`\`\`mermaid\n${code}\n\`\`\`\n`);
  const validatorPath = path.join(__dirname, 'validate.mjs');
  try {
    execSync(`node ${validatorPath} ${tempFilePath}`, { stdio: 'pipe' });
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      error: err.stderr ? err.stderr.toString() : err.message
    };
  }
}

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  let baseRef = 'main';
  let dryRun = false;
  let outputPath = null;
  let gatewayId = 'default-gateway';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base') {
      baseRef = args[++i];
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--output') {
      outputPath = args[++i];
    } else if (args[i] === '--gateway') {
      gatewayId = args[++i];
    }
  }

  const diffData = getGitDiff(baseRef);
  if (!diffData) {
    console.log('✅ No changes detected in current branch compared to base.');
    process.exit(0);
  }

  // Construct structured analysis prompt
  const prompt = `You are a Senior Systems Architect analyzing branch changes to generate documentation.
Analyze the following git diff and output a single Mermaid diagram visualizing the logical or architectural changes.

Rules:
1. Output a Mermaid 'flowchart LR' (for architecture / dependencies) or
   'flowchart TD' (for a process / data flow). Do NOT use 'architecture-beta'.
   - Group related pieces with subgraphs; nodes = services / tables / routes.
   - Flowchart syntax:
     flowchart LR
       subgraph API
         R_contacts["POST /api/showroom-contacts"]
       end
       R_contacts --> D_contacts[("showroom_store_contacts")]
2. EVERY node label MUST be wrapped in a shape with quotes, e.g. A["Label"],
   B[("db_table")], C{"decision?"}. Never leave a multi-word label unquoted.
   Node ids are single tokens (letters, digits, underscore) — no spaces.
3. Output ONLY the raw Mermaid diagram block wrapped in \`\`\`mermaid and \`\`\`. No other text.

Git Diff Summary:
${diffData.stat}

Changed Files:
${diffData.files.map(f => `- ${f}`).join('\n')}

Focused Code Diff:
\`\`\`diff
${diffData.codeDiff.slice(0, 8000)}
\`\`\``;

  if (dryRun) {
    console.log('=== DRY RUN PROMPT ===');
    console.log(prompt);
    process.exit(0);
  }

  const tempFilePath = path.join(__dirname, 'temp_validate.md');
  let currentResponse = '';
  let currentDiagram = '';
  let attempt = 0;
  let validationResult = { valid: false, error: null };

  console.error('🔄 Invoking Gemini via Cloudflare AI Gateway to generate branch diagram...');

  while (attempt < 3) {
    currentResponse = await callGemini(prompt, currentResponse, validationResult.error, gatewayId);
    currentDiagram = extractMermaidBlock(currentResponse);

    console.error(`🔄 Attempt ${attempt + 1}: Validating generated diagram...`);
    validationResult = validateDiagram(currentDiagram, tempFilePath);

    if (validationResult.valid) {
      break;
    } else {
      console.error(`⚠️ Attempt ${attempt + 1} failed validation:\n${validationResult.error}`);
      attempt++;
    }
  }

  // Clean up temp file
  if (fs.existsSync(tempFilePath)) {
    fs.unlinkSync(tempFilePath);
  }

  if (!validationResult.valid) {
    console.error('❌ Failed to generate valid Mermaid syntax after 3 attempts.');
    process.exit(1);
  }

  if (!outputPath) {
    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '_').slice(0, 15);
    outputPath = path.join(outputDir, `${timestamp}_branch_impact.md`);
  }

  fs.writeFileSync(outputPath, `\`\`\`mermaid\n${currentDiagram}\n\`\`\`\n`);
  console.log(`✅ Diagram successfully generated and validated: ${outputPath}`);
}

main();
