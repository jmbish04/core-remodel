#!/usr/bin/env node
/**
 * Mermaid Flowchart Diagram Generator
 * ===================================
 *
 * Generates a flowchart (flowchart TD/LR) from a JSON definition
 * and validates the syntax using `validate.mjs`.
 *
 * Usage:
 *   node flow.mjs --input spec.json --output diagram.md
 *   node flow.mjs (uses built-in demo template)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_FLOW = {
  direction: 'LR',
  nodes: [
    { id: 'start', label: 'User Request', shape: 'round' },
    { id: 'auth', label: 'Authorized?', shape: 'rhombus' },
    { id: 'allow', label: 'Render Dashboard', shape: 'rect' },
    { id: 'deny', label: 'Redirect to Login', shape: 'rect' }
  ],
  edges: [
    { from: 'start', to: 'auth' },
    { from: 'auth', to: 'allow', label: 'Yes' },
    { from: 'auth', to: 'deny', label: 'No' }
  ]
};

function renderNodeShape(node) {
  const label = node.label || node.id;
  switch (node.shape) {
    case 'round':
      return `${node.id}("${label}")`;
    case 'rhombus':
    case 'decision':
      return `${node.id}{"${label}"}`;
    case 'circle':
      return `${node.id}(("${label}"))`;
    case 'stadium':
      return `${node.id}(["${label}"])`;
    case 'subroutine':
      return `${node.id}[["${label}"]]`;
    case 'asymmetric':
      return `${node.id}>"${label}"]`;
    case 'rect':
    default:
      return `${node.id}["${label}"]`;
  }
}

function generateFlowMermaid(spec) {
  const dir = spec.direction || 'TD';
  const lines = [`flowchart ${dir}`];

  // 1. Render nodes
  if (spec.nodes) {
    for (const node of spec.nodes) {
      lines.push(`    ${renderNodeShape(node)}`);
    }
  }

  // 2. Render subgraphs (optional)
  if (spec.subgraphs) {
    for (const sub of spec.subgraphs) {
      lines.push(`    subgraph ${sub.title || sub.id}`);
      if (sub.nodes) {
        for (const node of sub.nodes) {
          lines.push(`        ${renderNodeShape(node)}`);
        }
      }
      lines.push('    end');
    }
  }

  // 3. Render edges
  if (spec.edges) {
    for (const edge of spec.edges) {
      const arrow = edge.label ? ` -->|"${edge.label}"| ` : ' --> ';
      lines.push(`    ${edge.from}${arrow}${edge.to}`);
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

  let spec = DEFAULT_FLOW;
  if (inputPath) {
    try {
      spec = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    } catch (err) {
      console.error(`❌ Error reading input JSON: ${err.message}`);
      process.exit(1);
    }
  }

  const mermaidStr = generateFlowMermaid(spec);
  const mdContent = `\`\`\`mermaid\n${mermaidStr}\n\`\`\`\n`;

  if (!outputPath) {
    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '_').slice(0, 15);
    outputPath = path.join(outputDir, `${timestamp}_flowchart.md`);
  }

  fs.writeFileSync(outputPath, mdContent);

  const validatorPath = path.join(__dirname, 'validate.mjs');
  try {
    execSync(`node ${validatorPath} ${outputPath}`, { stdio: 'inherit' });
    console.error(`✅ Flowchart diagram generated and validated: ${outputPath}`);
  } catch (err) {
    console.error(`❌ Validation failed for the flowchart diagram.`);
    process.exit(1);
  }
}

main();
