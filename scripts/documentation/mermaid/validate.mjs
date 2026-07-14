#!/usr/bin/env node
/**
 * Headless Mermaid Syntax Validator
 * =================================
 *
 * Validates Mermaid diagram syntax offline using `@mermaid-js/parser`.
 * Supports:
 *   - Raw `.mmd` or `.txt` diagram files
 *   - Markdown files containing one or more ```mermaid blocks
 *
 * Usage:
 *   node validate.mjs <path-to-file>
 *   cat diagram.mmd | node validate.mjs
 */

import fs from 'fs';
import path from 'path';
import { parse } from '@mermaid-js/parser';

// Supported diagram types natively validated by `@mermaid-js/parser` (v1.2.0)
const LANGIUM_PARSABLE_TYPES = {
  'gitGraph': 'gitGraph',
  'architecture-beta': 'architecture'
};

/**
 * Clean comments and init directives to extract the core diagram type.
 */
function detectDiagramType(code) {
  const clean = code
    // Remove init directives: %%{init: {...}}%%
    .replace(/%%\{[\s\S]*?\}%%/g, '')
    // Remove inline comments: %% comment
    .replace(/%%.*/g, '')
    .trim();

  // The first word should be the diagram type
  const match = clean.match(/^([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

/**
 * Extract all mermaid blocks from a markdown string.
 */
function extractMermaidBlocks(content) {
  const blocks = [];
  const regex = /```mermaid\s*\n([\s\S]*?)\n```/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

/**
 * Validate a single block of Mermaid code.
 */
async function validateBlock(code, index = 0) {
  const type = detectDiagramType(code);
  if (!type) {
    return {
      valid: false,
      error: new Error(`Could not determine diagram type for block ${index + 1}. Make sure it starts with a valid keyword (e.g. erDiagram, flowchart, sequenceDiagram).`)
    };
  }

  // If Langium parser supports this type, run strict syntax check
  if (LANGIUM_PARSABLE_TYPES[type]) {
    try {
      const mappedType = LANGIUM_PARSABLE_TYPES[type];
      await parse(mappedType, code);
      return { valid: true };
    } catch (err) {
      return {
        valid: false,
        error: err
      };
    }
  }

  // Fallback structural check for other diagram types
  // Check for common brace, paren, and bracket imbalances
  const pairs = {
    '{': '}',
    '[': ']',
    '(': ')'
  };
  const stack = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line || line.startsWith('%%')) continue;

    // Don't count braces/parens that live inside quoted labels, and don't count
    // the braces that are part of mermaid ER crow's-foot cardinality
    // (`o{`, `|{`, `}o`, `}|`) — those are relationship glyphs, not blocks.
    line = line
      .replace(/"[^"]*"/g, '""')
      .replace(/[|o]\{/g, '')
      .replace(/\}[|o]/g, '');

    for (let charIdx = 0; charIdx < line.length; charIdx++) {
      const char = line[charIdx];
      if (pairs[char]) {
        stack.push({ char, line: i + 1, col: charIdx + 1 });
      } else if (Object.values(pairs).includes(char)) {
        if (stack.length === 0) {
          return {
            valid: false,
            error: new Error(`Syntax Error: Unmatched closing character '${char}' at line ${i + 1}, column ${charIdx + 1}`)
          };
        }
        const top = stack.pop();
        if (pairs[top.char] !== char) {
          return {
            valid: false,
            error: new Error(`Syntax Error: Mismatched closing character '${char}' at line ${i + 1}, column ${charIdx + 1}. Expected '${pairs[top.char]}' to close '${top.char}' from line ${top.line}`)
          };
        }
      }
    }
  }

  if (stack.length > 0) {
    const top = stack.pop();
    return {
      valid: false,
      error: new Error(`Syntax Error: Unclosed opening character '${top.char}' from line ${top.line}, column ${top.col}`)
    };
  }

  console.warn(`⚠️ Warning: Diagram type "${type}" is not natively validated by the Langium parser. Passed basic structural balance checks.`);
  return { valid: true };
}

async function main() {
  let content = '';
  const filePath = process.argv[2];

  if (filePath) {
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      console.error(`❌ Error reading file: ${err.message}`);
      process.exit(1);
    }
  } else {
    // Read from stdin
    content = fs.readFileSync(0, 'utf-8');
  }

  if (!content.trim()) {
    console.error('❌ Empty content received.');
    process.exit(1);
  }

  // Determine if it is markdown or a raw diagram
  const isMarkdown = filePath ? filePath.endsWith('.md') : content.includes('```mermaid');
  const blocks = isMarkdown ? extractMermaidBlocks(content) : [content];

  if (blocks.length === 0) {
    console.log('✅ No Mermaid diagram blocks found to validate.');
    process.exit(0);
  }

  let failed = false;

  for (let idx = 0; idx < blocks.length; idx++) {
    const block = blocks[idx];
    const result = await validateBlock(block, idx);
    if (!result.valid) {
      failed = true;
      console.error(`\n❌ Mermaid Syntax Error in Block ${idx + 1}:`);
      console.error(result.error.message || result.error);
      
      // If the parser gave line/column information, output it in structured format
      if (result.error.hash) {
        const { line, loc } = result.error.hash;
        console.error(JSON.stringify({
          block: idx + 1,
          line: line || (loc ? loc.first_line : 'unknown'),
          column: loc ? loc.first_column : 'unknown',
          message: result.error.message
        }));
      }
    }
  }

  if (failed) {
    process.exit(1);
  }

  console.log(`✅ All ${blocks.length} diagram block(s) validated successfully.`);
  process.exit(0);
}

// Only run if called directly from CLI
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] === path.resolve(process.argv[1])) {
  main();
}
