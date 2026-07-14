#!/usr/bin/env node
/**
 * setup-mermaidcn.mjs
 * ====================
 *
 * Installs and configures the complete react-mermaidcn React diagramming
 * suite (Shadcn-compatible, zoom/pan enabled) in the Astro/React workspace.
 *
 * Fetches the components directly from the Riley1101/mermaidcn repository
 * on GitHub, refactors imports to align with the workspace aliasing structure,
 * and outputs everything directly under `src/frontend/`.
 *
 * Usage:
 *   node setup-mermaidcn.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_RAW_URL = 'https://raw.githubusercontent.com/Riley1101/mermaidcn/main';

const FILE_MANIFEST = [
  // Core Component & Themes
  {
    src: 'components/mermaid.tsx',
    dest: 'src/frontend/components/mermaidcn/mermaid.tsx',
    type: 'component'
  },
  {
    src: 'components/zoom-pan.tsx',
    dest: 'src/frontend/components/mermaidcn/zoom-pan.tsx',
    type: 'component'
  },
  {
    src: 'lib/mermaid-themes.ts',
    dest: 'src/frontend/lib/mermaid-themes.ts',
    type: 'lib'
  },
  // Playground Components
  {
    src: 'components/mermaid-editor.tsx',
    dest: 'src/frontend/components/mermaidcn/mermaid-editor.tsx',
    type: 'component'
  },
  {
    src: 'components/mermaid-preview.tsx',
    dest: 'src/frontend/components/mermaidcn/mermaid-preview.tsx',
    type: 'component'
  },
  {
    src: 'components/mermaid-toolbar.tsx',
    dest: 'src/frontend/components/mermaidcn/mermaid-toolbar.tsx',
    type: 'component'
  },
  {
    src: 'components/mermaid-playground.tsx',
    dest: 'src/frontend/components/mermaidcn/mermaid-playground.tsx',
    type: 'component'
  },
  {
    src: 'lib/diagram-templates.ts',
    dest: 'src/frontend/lib/diagram-templates.ts',
    type: 'lib'
  }
];

async function fetchRawFile(srcPath) {
  const url = `${BASE_RAW_URL}/${srcPath}`;
  console.log(`🌐 Fetching: ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch file from GitHub (${res.status}): ${url}`);
  }
  return res.text();
}

function refactorImports(code, type) {
  if (type !== 'component') return code;

  return code
    // Replace standalone component imports with our nested mermaidcn folder
    .replace(/@\/components\/mermaid-editor/g, '@/components/mermaidcn/mermaid-editor')
    .replace(/@\/components\/mermaid-preview/g, '@/components/mermaidcn/mermaid-preview')
    .replace(/@\/components\/mermaid-toolbar/g, '@/components/mermaidcn/mermaid-toolbar')
    .replace(/@\/components\/mermaid/g, '@/components/mermaidcn/mermaid')
    .replace(/@\/components\/zoom-pan/g, '@/components/mermaidcn/zoom-pan')
    // Fallback: fix relative imports if any
    .replace(/"\.\/zoom-pan"/g, '"@/components/mermaidcn/zoom-pan"')
    .replace(/"\.\/mermaid"/g, '"@/components/mermaidcn/mermaid"')
    .replace(/"\.\/mermaid-editor"/g, '"@/components/mermaidcn/mermaid-editor"')
    .replace(/"\.\/mermaid-preview"/g, '"@/components/mermaidcn/mermaid-preview"')
    .replace(/"\.\/mermaid-toolbar"/g, '"@/components/mermaidcn/mermaid-toolbar"');
}

async function main() {
  console.log('🚀 Initializing MermaidCN Component Suite Setup...');

  for (const item of FILE_MANIFEST) {
    try {
      const destPath = path.join(process.cwd(), item.dest);
      const destDir = path.dirname(destPath);

      // Ensure directory exists
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      // Fetch the raw code
      let rawCode = await fetchRawFile(item.src);

      // Refactor import mappings to resolve inside our alias architecture
      const processedCode = refactorImports(rawCode, item.type);

      // Write to file
      fs.writeFileSync(destPath, processedCode, 'utf8');
      console.log(`✅ Installed: ${item.dest}`);
    } catch (err) {
      console.error(`❌ Error installing ${item.src}: ${err.message}`);
      process.exit(1);
    }
  }

  console.log('\n🎉 MermaidCN installation and configuration completed successfully!');
  console.log('All components placed under: src/frontend/components/mermaidcn/');
  console.log('All library modules placed under: src/frontend/lib/');
}

main();
