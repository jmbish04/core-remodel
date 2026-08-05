import * as fs from 'fs';
import * as path from 'path';

const PAGES_DIR = path.join(process.cwd(), 'src/frontend/pages');

function walkDir(dir: string): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walkDir(file));
    } else {
      if (file.endsWith('.astro') || file.endsWith('.ts')) {
          results.push(file);
      }
    }
  });
  return results;
}

function parseFrontmatter(content: string): string | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (match && match[1]) {
      return match[1];
  }
  return null;
}

function extractGuards(frontmatter: string): string[] {
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

function generateRoute(filePath: string): { route: string, component: string, guards: string[] } {
  const relativePath = path.relative(PAGES_DIR, filePath);
  let route = '/' + relativePath.replace(/\\/g, '/');

  // Handle index files
  route = route.replace(/\/index\.astro$/, '');
  route = route.replace(/\/index\.ts$/, '');

  // Handle extensions
  route = route.replace(/\.astro$/, '');
  route = route.replace(/\.json\.ts$/, '.json');
  route = route.replace(/\.xml\.ts$/, '.xml');

  if (route === '') {
      route = '/';
  }

  const content = fs.readFileSync(filePath, 'utf8');
  let guards: string[] = [];
  const frontmatter = parseFrontmatter(content);
  if (frontmatter) {
      guards = extractGuards(frontmatter);
  }

  return {
      route,
      component: `src/frontend/pages/${relativePath}`,
      guards
  };
}

const files = walkDir(PAGES_DIR);
const routes = files.map(generateRoute).sort((a, b) => a.route.localeCompare(b.route));

let markdown = `# Routing\n\n[← Back to Index](README.md)\n\n`;
markdown += `This project uses Astro's file-based routing. The routes below map the URL path to the corresponding component located in \`src/frontend/pages/\`.\n\n`;
markdown += `## Route Table\n\n`;
markdown += `| Route Path | Component File | Guards/Loaders (Frontmatter Analysis) |\n`;
markdown += `| :--- | :--- | :--- |\n`;

for (const route of routes) {
    const guardText = route.guards.length > 0 ? route.guards.join(', ') : 'None detected';
    markdown += `| \`${route.route}\` | \`${route.component}\` | ${guardText} |\n`;
}

fs.writeFileSync(path.join(process.cwd(), 'docs/routing.md'), markdown);
console.log('Successfully generated docs/routing.md');
