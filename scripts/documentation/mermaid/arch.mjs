#!/usr/bin/env node
/**
 * Mermaid Architecture Diagram Generator
 * =====================================
 *
 * Generates an architecture diagram (architecture-beta) from a JSON definition
 * and validates the syntax using `validate.mjs`.
 *
 * Usage:
 *   node arch.mjs --input spec.json --output diagram.md
 *   node arch.mjs (uses built-in demo template)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_ARCH = {
  groups: [
    { id: 'api', icon: 'cloud', label: 'API Layer' },
    { id: 'data', icon: 'database', label: 'Data Store' }
  ],
  services: [
    { id: 'server', icon: 'server', label: 'Astro/Hono Server', in: 'api' },
    { id: 'auth', icon: 'lock', label: 'OAuth Provider', in: 'api' },
    { id: 'd1', icon: 'database', label: 'Cloudflare D1', in: 'data' },
    { id: 'r2', icon: 'disk', label: 'R2 Object Storage', in: 'data' }
  ],
  edges: [
    { from: 'auth:B', to: 'T:server' },
    { from: 'server:B', to: 'T:d1' },
    { from: 'server:R', to: 'L:r2' }
  ]
};

function generateArchMermaid(spec) {
  const lines = ['architecture-beta'];

  // 1. Render groups
  if (spec.groups) {
    for (const group of spec.groups) {
      const parentStr = group.in ? ` in ${group.in}` : '';
      lines.push(`    group ${group.id}(${group.icon})[${group.label || group.id}]${parentStr}`);
    }
  }

  // 2. Render services
  if (spec.services) {
    for (const service of spec.services) {
      const parentStr = service.in ? ` in ${service.in}` : '';
      lines.push(`    service ${service.id}(${service.icon})[${service.label || service.id}]${parentStr}`);
    }
  }

  // 3. Render junctions
  if (spec.junctions) {
    for (const junc of spec.junctions) {
      lines.push(`    junction ${junc.id}`);
    }
  }

  // 4. Render edges
  if (spec.edges) {
    for (const edge of spec.edges) {
      lines.push(`    ${edge.from} -- ${edge.to}`);
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

  let spec = DEFAULT_ARCH;
  if (inputPath) {
    try {
      spec = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    } catch (err) {
      console.error(`❌ Error reading input JSON: ${err.message}`);
      process.exit(1);
    }
  }

  const mermaidStr = generateArchMermaid(spec);
  const mdContent = `\`\`\`mermaid\n${mermaidStr}\n\`\`\`\n`;

  if (!outputPath) {
    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '_').slice(0, 15);
    outputPath = path.join(outputDir, `${timestamp}_architecture.md`);
  }

  fs.writeFileSync(outputPath, mdContent);

  const validatorPath = path.join(__dirname, 'validate.mjs');
  try {
    execSync(`node ${validatorPath} ${outputPath}`, { stdio: 'inherit' });
    console.error(`✅ Architecture diagram generated and validated: ${outputPath}`);
  } catch (err) {
    console.error(`❌ Validation failed for the architecture diagram.`);
    process.exit(1);
  }
}

main();
