import fs from 'fs';
import path from 'path';

function findRoutes(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      findRoutes(filePath, fileList);
    } else {
      if (filePath.endsWith('.astro') || filePath.endsWith('.tsx') || filePath.endsWith('.json.ts') || filePath.endsWith('.xml.ts')) {
        fileList.push(filePath);
      }
    }
  }

  return fileList;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (match && match[1]) {
      return match[1];
  }
  return null;
}

function extractGuards(frontmatter) {
    const guards = [];
    if (frontmatter.includes('requireAuth(') || frontmatter.includes('requireAuth ')) {
        guards.push('requireAuth');
    }
    if (frontmatter.includes('requireAdmin(') || frontmatter.includes('requireAdmin ')) {
        guards.push('requireAdmin');
    }
    if (frontmatter.includes('requireContractor(') || frontmatter.includes('requireContractor ')) {
        guards.push('requireContractor');
    }
    // Very rudimentary extraction of some common loaders
    if (frontmatter.includes('Astro.locals.db') || frontmatter.includes('const db =')) {
         guards.push('dbLoader');
    }
    return guards;
}

const pagesDir = 'src/frontend/pages';
const files = findRoutes(pagesDir);

const routes = files.map(file => {
  let routePath = file.replace(pagesDir, '').replace(/\\/g, '/');

  // Remove extension
  routePath = routePath.replace(/\.(astro|tsx)$/, '');
  routePath = routePath.replace(/\.json\.ts$/, '.json');
  routePath = routePath.replace(/\.xml\.ts$/, '.xml');

  // Handle index
  if (routePath.endsWith('/index')) {
    routePath = routePath.replace('/index', '');
    if (routePath === '') routePath = '/';
  }

  // Remove trailing slash if not root
  if (routePath !== '/' && routePath.endsWith('/')) {
    routePath = routePath.slice(0, -1);
  }

  return { routePath, componentFile: file };
});

routes.sort((a, b) => a.routePath.localeCompare(b.routePath));

let mdContent = `# Routing

[← Back to Index](README.md)

This project uses Astro's file-based routing. The routes below map the URL path to the corresponding component located in \`src/frontend/pages/\`.

## Route Table

| Route Path | Component File | Guards/Loaders |
| ---------- | -------------- | -------------- |
`;

for (const route of routes) {
  let guard = "None (Astro Frontmatter)";
  if (route.componentFile.endsWith('.ts')) {
    guard = "API / Endpoint";
  } else {
      const content = fs.readFileSync(route.componentFile, 'utf8');
      const frontmatter = parseFrontmatter(content);
      if (frontmatter) {
          const guards = extractGuards(frontmatter);
          if (guards.length > 0) {
              guard = guards.join(', ');
          }
      }
  }
  mdContent += `| ${route.routePath} | ${route.componentFile} | ${guard} |\n`;
}

const outputPath = 'docs/routing.md';
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, mdContent);
console.log('docs/routing.md generated successfully.');
