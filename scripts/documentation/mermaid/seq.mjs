#!/usr/bin/env node
/**
 * Mermaid Sequence Diagram Generator
 * ==================================
 *
 * Generates a sequence diagram (sequenceDiagram) from a JSON definition
 * and validates the syntax using `validate.mjs`.
 *
 * Usage:
 *   node seq.mjs --input spec.json --output diagram.md
 *   node seq.mjs (uses built-in demo template)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_SEQ = {
  participants: [
    { id: 'client', label: 'Astro Client', type: 'actor' },
    { id: 'hono', label: 'Hono API Router', type: 'participant' },
    { id: 'd1', label: 'D1 SQL DB', type: 'participant' }
  ],
  interactions: [
    { from: 'client', to: 'hono', arrow: '->>', message: 'GET /api/connect/tools (Bearer Token)' },
    { from: 'hono', to: 'hono', arrow: '->', message: 'Validate OAuth session' },
    { from: 'hono', to: 'd1', arrow: '->>', message: 'Query active tool definitions' },
    { from: 'd1', to: 'hono', arrow: '-->>', message: 'Return schema records' },
    { from: 'hono', to: 'client', arrow: '-->>', message: '200 OK (JSON array)' }
  ]
};

function generateSeqMermaid(spec) {
  const lines = ['sequenceDiagram'];

  // 1. Render participants
  if (spec.participants) {
    for (const p of spec.participants) {
      const type = p.type || 'participant';
      const labelStr = p.label ? ` as ${p.label}` : '';
      lines.push(`    ${type} ${p.id}${labelStr}`);
    }
  }

  lines.push(''); // add a blank line for readability

  // 2. Render interactions
  if (spec.interactions) {
    for (const i of spec.interactions) {
      const arrow = i.arrow || '->>';
      lines.push(`    ${i.from}${arrow}${i.to}: ${i.message}`);
      if (i.activate) {
        lines.push(`    activate ${i.activate}`);
      }
      if (i.deactivate) {
        lines.push(`    deactivate ${i.deactivate}`);
      }
    }
  }

  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  let inputPath = null;
  let outputPath = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' || args[i] === '-i') {
      inputPath = args[++i];
    } else if (args[i] === '--output' || args[i] === '-o') {
      outputPath = args[++i];
    }
  }

  let spec = DEFAULT_SEQ;
  if (inputPath) {
    try {
      spec = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    } catch (err) {
      console.error(`❌ Error reading input JSON: ${err.message}`);
      process.exit(1);
    }
  }

  const mermaidStr = generateSeqMermaid(spec);
  const mdContent = `\`\`\`mermaid\n${mermaidStr}\n\`\`\`\n`;

  if (!outputPath) {
    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '_').slice(0, 15);
    outputPath = path.join(outputDir, `${timestamp}_sequence.md`);
  }

  fs.writeFileSync(outputPath, mdContent);

  const validatorPath = path.join(__dirname, 'validate.mjs');
  try {
    // Array args (no shell) — avoids injection via outputPath.
    execFileSync('node', [validatorPath, outputPath], { stdio: 'inherit' });
    console.error(`✅ Sequence diagram generated and validated: ${outputPath}`);
  } catch (err) {
    console.error(`❌ Validation failed for the sequence diagram.`);
    process.exit(1);
  }
}

main();
