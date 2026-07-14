#!/usr/bin/env node
/**
 * D1 Schema → Mermaid ER Diagram Generator (ESM Node.js)
 * ========================================================
 *
 * Generates Mermaid.js erDiagram markup from a Cloudflare D1 database schema.
 * Supports three data sources:
 *   1. Live D1 (local)   — queries the local wrangler dev sandbox
 *   2. Live D1 (remote)  — queries the production D1 instance
 *   3. Migration files   — parses Drizzle-generated .sql migrations offline
 *
 * Output is saved to `scripts/documentation/mermaid/output/<timestamp>_diagram.md`
 * and validated programmatically.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default rendering settings for the Mermaid directive
const MERMAID_DEFAULTS = {
  theme: 'default',
  layout: 'TB',
  minWidth: 250,
  padding: 20,
  fontSize: 14
};

const SQL_TYPES = [
  'INTEGER', 'INT', 'TEXT', 'REAL', 'BLOB',
  'NUMERIC', 'BOOLEAN', 'TIMESTAMP', 'DATETIME', 'VARCHAR'
];

/**
 * Helper to match glob patterns (e.g. showroom_*)
 */
function matchGlob(str, pattern) {
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  const regex = new RegExp(`^${regexPattern}$`, 'i');
  return regex.test(str);
}

/**
 * Shell out to wrangler CLI to execute SQL queries.
 */
function runWranglerQuery(dbBinding, query, isRemote) {
  const envFlag = isRemote ? '--remote' : '--local';

  try {
    // Array args (no shell) — dbBinding/query are passed literally, no injection.
    const stdout = execFileSync(
      'npx',
      ['wrangler', 'd1', 'execute', dbBinding, envFlag, `--command=${query}`, '--json'],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    // Locate the JSON array block — wrangler wraps results in [{...}]
    const jsonMatch = stdout.match(/(\[\s*\{[\s\S]*?\}\s*\])/);
    if (!jsonMatch) {
      const jsonStart = stdout.indexOf('[');
      if (jsonStart !== -1) {
        return JSON.parse(stdout.slice(jsonStart));
      }
      throw new Error(`Could not find valid JSON array in wrangler output:\n${stdout}`);
    }
    return JSON.parse(jsonMatch[1]);
  } catch (err) {
    console.error(`❌ Wrangler CLI execution error:\n${err.stderr || err.message}`);
    process.exit(1);
  }
}

/**
 * Paren-aware comma splitter to keep default values with parens intact.
 */
function splitColumns(sqlInner) {
  const parts = [];
  let depth = 0;
  let current = [];

  for (let i = 0; i < sqlInner.length; i++) {
    const char = sqlInner[i];
    if (char === '(') {
      depth++;
      current.push(char);
    } else if (char === ')') {
      depth--;
      current.push(char);
    } else if (char === ',' && depth === 0) {
      parts.push(current.join(''));
      current = [];
    } else {
      current.push(char);
    }
  }
  if (current.length > 0) {
    parts.push(current.join(''));
  }
  return parts;
}

/**
 * Parse a single column definition into name, type, and PK/UK modifiers.
 */
function parseColumnDef(colDef) {
  const cleaned = colDef.trim();
  if (!cleaned) return null;

  // Ignore table-level constraints
  const upper = cleaned.toUpperCase();
  if (
    upper.startsWith('FOREIGN KEY') ||
    upper.startsWith('PRIMARY KEY') ||
    upper.startsWith('UNIQUE(') ||
    upper.startsWith('CHECK')
  ) {
    return null;
  }

  const parts = cleaned.split(/\s+/);
  if (parts.length === 0) return null;

  // First token is name
  let colName = parts[0].replace(/["`]/g, '');

  // Second token is type (only if recognized SQL type)
  let colType = 'unknown';
  if (parts.length > 1) {
    const candidate = parts[1].toUpperCase().replace(/,$/, '');
    const matchedType = SQL_TYPES.find(t => candidate.startsWith(t));
    if (matchedType) {
      // Strip size/precision info: e.g. VARCHAR(255) -> varchar
      colType = parts[1].replace(/[^a-zA-Z]/g, '').toLowerCase();
    }
  }

  // Sanitize for Mermaid grammar requirement: alphanumeric + underscore only
  colName = colName.replace(/[^a-zA-Z0-9_]/g, '');
  colType = colType.replace(/[^a-zA-Z0-9_]/g, '');

  if (!colName || !colType) return null;

  const isPk = upper.includes('PRIMARY KEY');
  const isUk = upper.includes(' UNIQUE');

  const modifier = isPk ? 'PK' : (isUk ? 'UK' : '');

  return { name: colName, type: colType, mod: modifier };
}

/**
 * Parse table-level FOREIGN KEY definitions.
 */
function parseFkFromConstraint(constraintText) {
  const regex = /FOREIGN\s+KEY\s*\(\s*`?(\w+)`?\s*\)\s*REFERENCES\s+`?(\w+)`?\s*\(\s*`?(\w+)`?\s*\)/i;
  const match = constraintText.trim().match(regex);
  if (match) {
    return {
      fromCol: match[1],
      toTable: match[2],
      toCol: match[3]
    };
  }
  return null;
}

/**
 * Parse column-level inline references (e.g. integer REFERENCES users(id))
 */
function parseInlineReferences(colDef) {
  const regex = /REFERENCES\s+`?(\w+)`?\s*\(\s*`?(\w+)`?\s*\)/i;
  const match = colDef.match(regex);
  if (match) {
    const parts = colDef.trim().split(/\s+/);
    const colName = parts[0] ? parts[0].replace(/["`]/g, '') : null;
    if (colName) {
      return {
        fromCol: colName,
        toTable: match[1],
        toCol: match[2]
      };
    }
  }
  return null;
}

/**
 * Query schema metadata from live D1 database.
 */
function getTablesAndColumns(dbBinding, isRemote) {
  const sql = "SELECT name, sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%';";
  const rows = runWranglerQuery(dbBinding, sql, isRemote);
  const tableData = rows[0]?.results || [];

  const tables = {};
  for (const row of tableData) {
    const tableName = row.name;
    const createSql = row.sql || '';

    const columns = [];
    const innerContent = createSql.match(/\(([\s\S]*)\)/);
    if (innerContent) {
      const rawDefs = splitColumns(innerContent[1]);
      for (const colDef of rawDefs) {
        const col = parseColumnDef(colDef);
        if (col) {
          columns.push(col);
        }
      }
    }
    tables[tableName] = columns;
  }
  return tables;
}

/**
 * Discover foreign key relationships from live D1.
 */
function getForeignKeys(dbBinding, tables, isRemote) {
  const relationships = [];
  for (const table of Object.keys(tables)) {
    const sql = `PRAGMA foreign_key_list(${table});`;
    const rows = runWranglerQuery(dbBinding, sql, isRemote);
    const fkData = rows[0]?.results || [];

    for (const fk of fkData) {
      relationships.push({
        from_table: table,
        from_col: fk.from,
        to_table: fk.table,
        to_col: fk.to
      });
    }
  }
  return relationships;
}

/**
 * Parse Drizzle DDL migration files to reconstruct database schema.
 */
function parseMigrationFiles(migrationDir) {
  if (!fs.existsSync(migrationDir)) {
    console.error(`❌ Migration directory not found: ${migrationDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(migrationDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.error(`❌ No .sql files found in: ${migrationDir}`);
    process.exit(1);
  }

  const tables = {};
  let relationships = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(migrationDir, file), 'utf8');
    const statements = content.split(/-->\s*statement-breakpoint/);

    for (let stmt of statements) {
      stmt = stmt.trim();
      if (!stmt) continue;

      // 1. CREATE TABLE
      const createMatch = stmt.match(/^CREATE\s+TABLE\s+`?(\w+)`?\s*\(([\s\S]*?)\)\s*;?\s*$/i);
      if (createMatch) {
        const tableName = createMatch[1];
        const body = createMatch[2];
        const columns = [];
        const rawDefs = splitColumns(body);

        for (const colDef of rawDefs) {
          const colDefStripped = colDef.trim();

          if (colDefStripped.toUpperCase().startsWith('FOREIGN KEY')) {
            const fk = parseFkFromConstraint(colDefStripped);
            if (fk) {
              relationships.push({
                from_table: tableName,
                from_col: fk.fromCol,
                to_table: fk.toTable,
                to_col: fk.toCol
              });
            }
            continue;
          }

          const inlineFk = parseInlineReferences(colDefStripped);
          if (inlineFk) {
            relationships.push({
              from_table: tableName,
              from_col: inlineFk.fromCol,
              to_table: inlineFk.toTable,
              to_col: inlineFk.toCol
            });
          }

          const col = parseColumnDef(colDefStripped);
          if (col) {
            columns.push(col);
          }
        }
        tables[tableName] = columns;
        continue;
      }

      // 2. DROP TABLE
      const dropMatch = stmt.match(/^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?`?(\w+)`?\s*;?\s*$/i);
      if (dropMatch) {
        const dropped = dropMatch[1];
        delete tables[dropped];
        relationships = relationships.filter(
          r => r.from_table !== dropped && r.to_table !== dropped
        );
        continue;
      }

      // 3. ALTER TABLE ... RENAME TO
      const renameMatch = stmt.match(/^ALTER\s+TABLE\s+`?(\w+)`?\s+RENAME\s+TO\s+`?(\w+)`?\s*;?\s*$/i);
      if (renameMatch) {
        const oldName = renameMatch[1];
        const newName = renameMatch[2];
        if (tables[oldName]) {
          tables[newName] = tables[oldName];
          delete tables[oldName];
          for (const r of relationships) {
            if (r.from_table === oldName) r.from_table = newName;
            if (r.to_table === oldName) r.to_table = newName;
          }
        }
        continue;
      }

      // 4. ALTER TABLE ... ADD
      const addMatch = stmt.match(/^ALTER\s+TABLE\s+`?(\w+)`?\s+ADD\s+(?:COLUMN\s+)?([\s\S]+?);\s*$/i);
      if (addMatch) {
        const tableName = addMatch[1];
        const colDefText = addMatch[2].trim();

        const inlineFk = parseInlineReferences(colDefText);
        if (inlineFk) {
          relationships.push({
            from_table: tableName,
            from_col: inlineFk.fromCol,
            to_table: inlineFk.toTable,
            to_col: inlineFk.toCol
          });
        }

        const col = parseColumnDef(colDefText);
        if (col && tables[tableName]) {
          const exists = tables[tableName].some(c => c.name === col.name);
          if (!exists) {
            tables[tableName].push(col);
          }
        }
        continue;
      }
    }
  }

  console.error(`📄 Parsed ${files.length} migration files → ${Object.keys(tables).length} tables, ${relationships.length} relationships`);
  return [tables, relationships];
}

/**
 * Generate formatted Mermaid ERD string.
 */
function generateMermaid(tables, relationships, selectedTables, cfg) {
  let filteredTables = { ...tables };
  let filteredRels = [...relationships];

  if (selectedTables && selectedTables.length > 0) {
    const matchedNames = new Set();
    for (const pattern of selectedTables) {
      for (const tName of Object.keys(tables)) {
        if (matchGlob(tName, pattern)) {
          matchedNames.add(tName);
        }
      }
    }

    filteredTables = {};
    for (const name of matchedNames) {
      filteredTables[name] = tables[name];
    }

    filteredRels = relationships.filter(
      r => matchedNames.has(r.from_table) && matchedNames.has(r.to_table)
    );
  }

  const initDirective = [
    `%%{init: {`,
    `  'theme': '${cfg.theme}',`,
    `  'er': {`,
    `    'layoutDirection': '${cfg.layout}',`,
    `    'minEntityWidth': ${cfg.minWidth},`,
    `    'entityPadding': ${cfg.padding},`,
    `    'fontSize': ${cfg.fontSize}`,
    `  }`,
    `}}%%`
  ].join('');

  const lines = [initDirective, 'erDiagram'];

  for (const [tName, cols] of Object.entries(filteredTables)) {
    lines.push(`    ${tName} {`);
    for (const col of cols) {
      const modStr = col.mod ? ` ${col.mod}` : '';
      lines.push(`        ${col.type} ${col.name}${modStr}`);
    }
    lines.push('    }\n');
  }

  for (const rel of filteredRels) {
    lines.push(`    ${rel.to_table} ||--o{ ${rel.from_table} : "has (${rel.from_col}->${rel.to_col})"`);
  }

  return lines.join('\n');
}

/**
 * Show help instructions.
 */
function showHelp() {
  console.log(`
D1 Schema → Mermaid ER Diagram Generator (ESM)
==============================================

Usage:
  node erd.mjs [options]

Data source:
  --db <name>           D1 database binding name (default: DB)
  --remote              Query production D1 instance
  --local               Query local wrangler sandbox (default)
  --from-migrations     Parse Drizzle migrations instead of D1. Defaults to 'drizzle' if no path provided.

Filtering:
  --tables <patterns>   Space-separated list of table name glob patterns (e.g. 'showroom_*' 'store_*')

Rendering overrides:
  --theme <theme>       Mermaid color theme (default, dark, forest, neutral)
  --layout <layout>     Layout direction: TB (top-bottom), LR (left-right)
  --min-width <width>   Minimum entity box width in pixels (default: 250)
  --padding <pixels>    Padding inside entity boxes in pixels (default: 20)
  --font-size <points>  Font size for attribute labels (default: 14)

Examples:
  node erd.mjs
  node erd.mjs --from-migrations
  node erd.mjs --from-migrations --tables 'showroom_*' 'store_*' --theme dark
`);
}

function parseCliArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    db: 'DB',
    remote: false,
    local: false,
    fromMigrations: null,
    tables: [],
    theme: MERMAID_DEFAULTS.theme,
    layout: MERMAID_DEFAULTS.layout,
    minWidth: MERMAID_DEFAULTS.minWidth,
    padding: MERMAID_DEFAULTS.padding,
    fontSize: MERMAID_DEFAULTS.fontSize,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--db') {
      parsed.db = args[++i];
    } else if (arg === '--remote') {
      parsed.remote = true;
    } else if (arg === '--local') {
      parsed.local = true;
    } else if (arg === '--from-migrations') {
      // Check if next arg is a directory, otherwise default to 'drizzle'
      const next = args[i + 1];
      if (next && !next.startsWith('-')) {
        parsed.fromMigrations = next;
        i++;
      } else {
        parsed.fromMigrations = 'drizzle';
      }
    } else if (arg === '--tables') {
      while (args[i + 1] && !args[i + 1].startsWith('-')) {
        parsed.tables.push(args[++i]);
      }
    } else if (arg === '--theme') {
      parsed.theme = args[++i];
    } else if (arg === '--layout') {
      parsed.layout = args[++i];
    } else if (arg === '--min-width') {
      parsed.minWidth = parseInt(args[++i], 10);
    } else if (arg === '--padding') {
      parsed.padding = parseInt(args[++i], 10);
    } else if (arg === '--font-size') {
      parsed.fontSize = parseInt(args[++i], 10);
    }
  }

  return parsed;
}

function main() {
  const args = parseCliArgs();
  if (args.help) {
    showHelp();
    process.exit(0);
  }

  let tables = {};
  let relationships = [];

  if (args.fromMigrations) {
    const migrationDir = path.isAbsolute(args.fromMigrations)
      ? args.fromMigrations
      : path.join(process.cwd(), args.fromMigrations);

    console.error(`🔄 Parsing migration files from: ${migrationDir}...`);
    [tables, relationships] = parseMigrationFiles(migrationDir);
  } else {
    const isRemote = args.remote && !args.local;
    console.error(`🔄 Extracting schema data from D1 bound as: ${args.db} (${isRemote ? 'Remote' : 'Local'})...`);
    tables = getTablesAndColumns(args.db, isRemote);
    relationships = getForeignKeys(args.db, tables, isRemote);
  }

  const mermaidOutput = generateMermaid(tables, relationships, args.tables, {
    theme: args.theme,
    layout: args.layout,
    minWidth: args.minWidth,
    padding: args.padding,
    fontSize: args.fontSize
  });

  const mdContent = `\`\`\`mermaid\n${mermaidOutput}\n\`\`\`\n`;

  // Output setup
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[-:T]/g, '_').slice(0, 15);
  const outputFile = path.join(outputDir, `${timestamp}_diagram.md`);

  // Write file
  fs.writeFileSync(outputFile, mdContent);

  // Validate the generated diagram
  const validatorPath = path.join(__dirname, 'validate.mjs');
  try {
    // Array args (no shell) — avoids injection via outputFile.
    execFileSync('node', [validatorPath, outputFile], { stdio: 'inherit' });
    console.error(`✅ Diagram generated and validated: ${outputFile}`);
  } catch (err) {
    console.error(`❌ Validation failed for the generated diagram.`);
    process.exit(1);
  }
}

main();
