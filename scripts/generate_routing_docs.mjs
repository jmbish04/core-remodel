import fs from 'fs';
import path from 'path';

function findRoutes(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      findRoutes(filePath, fileList);
    } else {
      if (filePath.endsWith('.astro') || filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
        fileList.push(filePath);
      }
    }
  }

  return fileList;
}

const pagesDir = 'src/frontend/pages';
const files = findRoutes(pagesDir);

const routes = files.map(file => {
  let routePath = file.replace(pagesDir, '').replace(/\\/g, '/');

  // Remove extension
  routePath = routePath.replace(/\.(astro|tsx|ts)$/, '');

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
  }
  mdContent += `| ${route.routePath} | ${route.componentFile} | ${guard} |\n`;
}

fs.writeFileSync('docs/routing.md', mdContent);
console.log('docs/routing.md generated successfully.');
