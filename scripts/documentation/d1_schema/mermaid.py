#!/usr/bin/env python3
"""
D1 Schema → Mermaid ER Diagram Generator
=========================================

Generates Mermaid.js erDiagram markup from a Cloudflare D1 database schema.
Supports three data sources:

  1. Live D1 (local)   — queries the local wrangler dev sandbox
  2. Live D1 (remote)  — queries the production D1 instance
  3. Migration files   — parses Drizzle-generated .sql migrations offline

Output is saved as a timestamped Markdown file containing a fenced mermaid block
in: scripts/documentation/d1_schema/diagram/<timestamp>_diagram.md

Usage:
  pnpm run db:diagram                                    # local D1
  pnpm run db:diagram:remote                             # production D1
  pnpm run db:diagram:migrations                         # from drizzle/ files
  python3 mermaid.py --from-migrations --tables 'store_*'  # filtered by glob
"""

import argparse
from fnmatch import fnmatch
import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path


# =============================================================================
# Live D1 Query Mode
# =============================================================================
# These functions shell out to `npx wrangler d1 execute` to introspect the
# schema of a running D1 database (local dev or remote production).
# =============================================================================


def run_wrangler_query(db_binding, query, is_remote):
    """
    Execute a SQL query against D1 via the Wrangler CLI.

    Wrangler's stdout contains log/warning lines before the actual JSON payload.
    We use regex to locate the JSON array in the output rather than relying on
    clean stdout, since wrangler may print warnings (e.g. secrets_store fields).

    Returns the parsed JSON array (list of result-set dicts).
    """
    env_flag = "--remote" if is_remote else "--local"
    cmd = [
        "npx",
        "wrangler",
        "d1",
        "execute",
        db_binding,
        env_flag,
        f"--command={query}",
        "--json",
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)

        # Locate the JSON array block — wrangler wraps results in [{...}]
        stdout = result.stdout
        json_match = re.search(r"(\[\s*\{.*\}\s*\])", stdout, re.DOTALL)
        if not json_match:
            # Fallback: try finding the first '[' and parse from there
            json_start = stdout.find("[")
            if json_start != -1:
                return json.loads(stdout[json_start:])
            raise ValueError(f"Could not find valid JSON array in wrangler output:\n{stdout}")

        return json.loads(json_match.group(1))
    except subprocess.CalledProcessError as e:
        print(f"❌ Wrangler CLI execution error:\n{e.stderr}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"❌ Error processing database metadata: {e}", file=sys.stderr)
        sys.exit(1)


def get_tables_and_columns(db_binding, is_remote):
    """
    Fetch all user-defined tables and their columns from a live D1 instance.

    Queries sqlite_schema for CREATE TABLE statements, then parses each one
    to extract column names, types, and modifiers (PK/UK). Filters out
    SQLite internals (sqlite_*) and Cloudflare system tables (_cf_*).
    """
    sql = (
        "SELECT name, sql FROM sqlite_schema "
        "WHERE type='table' "
        "AND name NOT LIKE 'sqlite_%' "
        "AND name NOT LIKE '_cf_%';"
    )
    rows = run_wrangler_query(db_binding, sql, is_remote)

    # Wrangler returns [{ "results": [...], "success": true, ... }]
    table_data = rows[0].get("results", []) if rows else []

    tables = {}
    for row in table_data:
        table_name = row["name"]
        create_sql = row["sql"] or ""

        # Extract the parenthesized body of CREATE TABLE (...)
        columns = []
        inner_content = re.search(r"\((.*)\)", create_sql, re.DOTALL)
        if inner_content:
            # Use paren-aware splitting so DEFAULT (datetime('now')) stays intact
            raw_defs = _split_columns(inner_content.group(1))
            for col_def in raw_defs:
                col = _parse_column_def(col_def)
                if col:
                    columns.append(col)

        tables[table_name] = columns
    return tables


def get_foreign_keys(db_binding, tables, is_remote):
    """
    Query PRAGMA foreign_key_list() for each table to discover FK relationships.

    This is used in live D1 mode where we can't reliably parse FKs from the
    CREATE TABLE sql returned by sqlite_schema (some are added via ALTER TABLE).
    Each PRAGMA call returns one row per FK column on that table.
    """
    relationships = []
    for table in tables.keys():
        sql = f"PRAGMA foreign_key_list({table});"
        rows = run_wrangler_query(db_binding, sql, is_remote)
        fk_data = rows[0].get("results", []) if rows else []

        for fk in fk_data:
            relationships.append({
                "from_table": table,
                "from_col": fk["from"],
                "to_table": fk["table"],
                "to_col": fk["to"],
            })
    return relationships


# =============================================================================
# Shared Column/FK Parsing Helpers
# =============================================================================
# These are used by both the live D1 path (get_tables_and_columns) and the
# offline migration parser (parse_migration_files).
# =============================================================================


def _split_columns(sql_inner):
    """
    Split a CREATE TABLE body on commas, but only at the top-level.

    Naive str.split(",") breaks on commas inside DEFAULT expressions like
    `DEFAULT (datetime('now'))`. This tracks parenthesis depth and only
    splits when depth == 0.

    Example input:
        `id` integer PRIMARY KEY, `created_at` integer DEFAULT (unixepoch())
    Returns:
        ["`id` integer PRIMARY KEY", "`created_at` integer DEFAULT (unixepoch())"]
    """
    parts = []
    depth = 0
    current = []
    for char in sql_inner:
        if char == "(":
            depth += 1
            current.append(char)
        elif char == ")":
            depth -= 1
            current.append(char)
        elif char == "," and depth == 0:
            parts.append("".join(current))
            current = []
        else:
            current.append(char)
    if current:
        parts.append("".join(current))
    return parts


def _parse_column_def(col_def):
    """
    Parse a single column definition into a Mermaid-safe column dict.

    Returns {"name": str, "type": str, "mod": "PK"|"UK"|""} or None for
    table-level constraints (FOREIGN KEY, PRIMARY KEY, UNIQUE(...), CHECK).

    The type is validated against known SQL types to avoid leaking DEFAULT
    expressions or constraint keywords into the Mermaid output. Both name
    and type are sanitized to alphanumeric + underscore only (Mermaid's
    ATTRIBUTE_WORD grammar requirement).
    """
    col_def = col_def.strip()
    if not col_def:
        return None

    # Skip table-level constraints — these aren't columns
    # Note: "UNIQUE(" catches UNIQUE(col1, col2) constraints but not
    # column-level "... UNIQUE" modifiers (those are caught below as is_uk)
    if any(
        col_def.upper().startswith(kw)
        for kw in ["FOREIGN KEY", "PRIMARY KEY", "UNIQUE(", "CHECK"]
    ):
        return None

    parts = col_def.split()
    if not parts:
        return None

    # First token is always the column name (possibly backtick-quoted)
    col_name = parts[0].replace('"', "").replace("`", "")

    # Second token should be the type, but only if it's a recognized SQL type.
    # This prevents DEFAULT, NOT, REFERENCES etc. from being misread as types.
    sql_types = (
        "INTEGER", "INT", "TEXT", "REAL", "BLOB",
        "NUMERIC", "BOOLEAN", "TIMESTAMP", "DATETIME", "VARCHAR",
    )
    col_type = "unknown"
    if len(parts) > 1:
        candidate = parts[1].upper().rstrip(",")
        if candidate.startswith(sql_types):
            # Strip any trailing parens/digits — e.g. VARCHAR(255) → varchar
            col_type = re.sub(r"[^a-zA-Z]", "", parts[1]).lower()

    # Sanitize for Mermaid: attribute words must match [a-zA-Z0-9_]+
    col_name = re.sub(r"[^a-zA-Z0-9_]", "", col_name)
    col_type = re.sub(r"[^a-zA-Z0-9_]", "", col_type)
    if not col_name or not col_type:
        return None

    # Detect PRIMARY KEY and UNIQUE modifiers in the full definition text
    upper_def = col_def.upper()
    is_pk = "PRIMARY KEY" in upper_def
    # Leading space prevents matching "UNIQUE(" table constraint start
    is_uk = " UNIQUE" in upper_def

    modifier = "PK" if is_pk else ("UK" if is_uk else "")
    return {"name": col_name, "type": col_type, "mod": modifier}


def _parse_fk_from_constraint(constraint_text):
    """
    Parse a table-level FOREIGN KEY constraint into a relationship dict.

    Handles: FOREIGN KEY (`col`) REFERENCES `other_table`(`other_col`) ...
    Returns {"from_col", "to_table", "to_col"} or None.
    """
    m = re.match(
        r"FOREIGN\s+KEY\s*\(\s*`?(\w+)`?\s*\)\s*REFERENCES\s+`?(\w+)`?\s*\(\s*`?(\w+)`?\s*\)",
        constraint_text.strip(),
        re.IGNORECASE,
    )
    if m:
        return {"from_col": m.group(1), "to_table": m.group(2), "to_col": m.group(3)}
    return None


def _parse_inline_references(col_def):
    """
    Parse an inline REFERENCES clause on a column definition.

    Handles: `col_name` integer REFERENCES other_table(other_col) ON DELETE ...
    Returns {"from_col", "to_table", "to_col"} or None.

    This is common in ALTER TABLE ADD statements where Drizzle uses inline
    FK syntax rather than a separate FOREIGN KEY constraint.
    """
    m = re.search(
        r"REFERENCES\s+`?(\w+)`?\s*\(\s*`?(\w+)`?\s*\)",
        col_def,
        re.IGNORECASE,
    )
    if m:
        parts = col_def.split()
        col_name = parts[0].replace('"', "").replace("`", "") if parts else None
        if col_name:
            return {"from_col": col_name, "to_table": m.group(1), "to_col": m.group(2)}
    return None


# =============================================================================
# Migration File Parser
# =============================================================================
# Reads Drizzle-generated .sql migration files and replays the DDL to build
# the table/column/FK state without needing a live D1 connection.
# =============================================================================


def parse_migration_files(migration_dir):
    """
    Parse all .sql migration files in sorted order and reconstruct the schema.

    Supports the four DDL patterns Drizzle generates:
      - CREATE TABLE  → register table + columns + FK constraints
      - DROP TABLE    → remove table + prune relationships
      - ALTER TABLE RENAME TO → rename (handles __new_* rebuild pattern)
      - ALTER TABLE ADD [COLUMN] → append column + inline FK

    Other statements (CREATE INDEX, INSERT INTO, etc.) are silently skipped.

    Returns (tables_dict, relationships_list) — same shape as the live D1 path.
    """
    migration_path = Path(migration_dir)
    if not migration_path.is_dir():
        print(f"❌ Migration directory not found: {migration_dir}", file=sys.stderr)
        sys.exit(1)

    sql_files = sorted(migration_path.glob("*.sql"))
    if not sql_files:
        print(f"❌ No .sql files found in: {migration_dir}", file=sys.stderr)
        sys.exit(1)

    tables = {}         # table_name → [column dicts]
    relationships = []  # [{from_table, from_col, to_table, to_col}, ...]

    for sql_file in sql_files:
        content = sql_file.read_text()

        # Drizzle separates statements with `--> statement-breakpoint` markers
        statements = re.split(r"-->\s*statement-breakpoint", content)

        for stmt in statements:
            stmt = stmt.strip()
            if not stmt:
                continue

            # --- CREATE TABLE ---
            # Captures table name and the full parenthesized body.
            # Overwrites any previous definition (handles Drizzle's
            # __new_* → DROP old → RENAME pattern for column alterations).
            create_match = re.match(
                r"CREATE\s+TABLE\s+`?(\w+)`?\s*\((.*)\)\s*;?\s*$",
                stmt,
                re.IGNORECASE | re.DOTALL,
            )
            if create_match:
                table_name = create_match.group(1)
                body = create_match.group(2)
                columns = []
                raw_defs = _split_columns(body)

                for col_def in raw_defs:
                    col_def_stripped = col_def.strip()

                    # Extract table-level FOREIGN KEY constraints as relationships
                    if col_def_stripped.upper().startswith("FOREIGN KEY"):
                        fk = _parse_fk_from_constraint(col_def_stripped)
                        if fk:
                            relationships.append({
                                "from_table": table_name,
                                "from_col": fk["from_col"],
                                "to_table": fk["to_table"],
                                "to_col": fk["to_col"],
                            })
                        continue

                    # Also check for inline REFERENCES on column definitions
                    inline_fk = _parse_inline_references(col_def_stripped)
                    if inline_fk:
                        relationships.append({
                            "from_table": table_name,
                            "from_col": inline_fk["from_col"],
                            "to_table": inline_fk["to_table"],
                            "to_col": inline_fk["to_col"],
                        })

                    # Parse the column itself (name, type, PK/UK modifier)
                    col = _parse_column_def(col_def_stripped)
                    if col:
                        columns.append(col)

                tables[table_name] = columns
                continue

            # --- DROP TABLE ---
            # Removes the table and any FK relationships that reference it.
            drop_match = re.match(
                r"DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?`?(\w+)`?\s*;?\s*$",
                stmt,
                re.IGNORECASE,
            )
            if drop_match:
                dropped = drop_match.group(1)
                tables.pop(dropped, None)
                relationships = [
                    r for r in relationships
                    if r["from_table"] != dropped and r["to_table"] != dropped
                ]
                continue

            # --- ALTER TABLE ... RENAME TO ---
            # Drizzle uses this for column type/nullability changes in SQLite:
            #   1. CREATE TABLE __new_foo (...)  — new schema
            #   2. INSERT INTO __new_foo SELECT * FROM foo  — copy data
            #   3. DROP TABLE foo
            #   4. ALTER TABLE __new_foo RENAME TO foo
            # We track all four to end up with the correct table name.
            rename_match = re.match(
                r"ALTER\s+TABLE\s+`?(\w+)`?\s+RENAME\s+TO\s+`?(\w+)`?\s*;?\s*$",
                stmt,
                re.IGNORECASE,
            )
            if rename_match:
                old_name = rename_match.group(1)
                new_name = rename_match.group(2)
                if old_name in tables:
                    tables[new_name] = tables.pop(old_name)
                    # Repoint all FK references from old name to new name
                    for r in relationships:
                        if r["from_table"] == old_name:
                            r["from_table"] = new_name
                        if r["to_table"] == old_name:
                            r["to_table"] = new_name
                continue

            # --- ALTER TABLE ... ADD [COLUMN] ---
            # Appends a column to an existing table. Also captures inline
            # REFERENCES if present (common in Drizzle incremental migrations).
            add_match = re.match(
                r"ALTER\s+TABLE\s+`?(\w+)`?\s+ADD\s+(?:COLUMN\s+)?(.+?);\s*$",
                stmt,
                re.IGNORECASE | re.DOTALL,
            )
            if add_match:
                table_name = add_match.group(1)
                col_def_text = add_match.group(2).strip()

                # Check for inline FK reference on the new column
                inline_fk = _parse_inline_references(col_def_text)
                if inline_fk:
                    relationships.append({
                        "from_table": table_name,
                        "from_col": inline_fk["from_col"],
                        "to_table": inline_fk["to_table"],
                        "to_col": inline_fk["to_col"],
                    })

                col = _parse_column_def(col_def_text)
                if col and table_name in tables:
                    # Guard against duplicate columns (e.g. if a migration
                    # re-adds a column that was already defined in CREATE TABLE)
                    existing_names = {c["name"] for c in tables[table_name]}
                    if col["name"] not in existing_names:
                        tables[table_name].append(col)
                continue

            # --- ALTER TABLE ... DROP [COLUMN] ---
            # Removes a column from an existing table so the diagram reflects the
            # final schema (Drizzle drops columns one per statement).
            drop_col_match = re.match(
                r"ALTER\s+TABLE\s+`?(\w+)`?\s+DROP\s+(?:COLUMN\s+)?`?(\w+)`?\s*;?\s*$",
                stmt,
                re.IGNORECASE,
            )
            if drop_col_match:
                table_name = drop_col_match.group(1)
                col_name = drop_col_match.group(2)
                if table_name in tables:
                    tables[table_name] = [
                        c for c in tables[table_name] if c["name"] != col_name
                    ]
                    relationships = [
                        r for r in relationships
                        if not (r["from_table"] == table_name and r["from_col"] == col_name)
                    ]
                continue

            # All other statements (CREATE INDEX, INSERT INTO, etc.) are
            # silently skipped — they don't affect the ER diagram.

    print(
        f"📄 Parsed {len(sql_files)} migration files → "
        f"{len(tables)} tables, {len(relationships)} relationships",
        file=sys.stderr,
    )
    return tables, relationships


# =============================================================================
# Mermaid Output Generation
# =============================================================================

# Default rendering settings for the Mermaid %%{init}%% directive.
# These produce readable diagrams in VS Code markdown preview and GitHub.
# All can be overridden via CLI flags (--theme, --layout, etc.).
MERMAID_DEFAULTS = {
    "theme": "default",
    "layout": "TB",         # TB = top-to-bottom, LR = left-to-right
    "min_width": 250,       # minimum entity box width in pixels
    "padding": 20,          # padding inside entity boxes in pixels
    "font_size": 14,        # font size in pixels for attribute labels
}


def generate_mermaid(tables, relationships, selected_tables=None, mermaid_config=None):
    """
    Build valid Mermaid.js erDiagram markup from tables and relationships.

    If selected_tables is provided, only matching tables (and their mutual
    relationships) are included. Supports glob patterns via fnmatch —
    e.g. ["showroom_*", "store_*"] matches all showroom and store tables.

    mermaid_config is a dict of rendering overrides (theme, layout, min_width,
    padding, font_size). Missing keys fall back to MERMAID_DEFAULTS.

    Each table becomes an entity block with typed attributes:
        table_name {
            integer id PK
            text name
        }

    Each FK becomes a relationship connector:
        parent ||--o{ child : "has (fk_col->pk_col)"
    """
    # Merge user overrides with defaults
    cfg = {**MERMAID_DEFAULTS, **(mermaid_config or {})}

    # Apply table filter (supports exact names and glob patterns)
    if selected_tables:
        matched = set()
        for pattern in selected_tables:
            for table_name in tables:
                if fnmatch(table_name, pattern):
                    matched.add(table_name)
        tables = {k: v for k, v in tables.items() if k in matched}
        # Only keep relationships where both endpoints are in the filtered set
        relationships = [
            r for r in relationships
            if r["from_table"] in tables and r["to_table"] in tables
        ]

    # Mermaid init directive — controls rendering size, layout, and theme
    init_directive = (
        f"%%{{init: {{'theme': '{cfg['theme']}', 'er': {{"
        f"'layoutDirection': '{cfg['layout']}', "
        f"'minEntityWidth': {cfg['min_width']}, "
        f"'entityPadding': {cfg['padding']}, "
        f"'fontSize': {cfg['font_size']}"
        f"}}}}}}%%"
    )
    lines = [init_directive, "erDiagram"]

    # Entity blocks — one per table, listing all columns with type and modifier
    for table_name, columns in tables.items():
        lines.append(f"    {table_name} {{")
        for col in columns:
            mod_str = f" {col['mod']}" if col["mod"] else ""
            lines.append(f"        {col['type']} {col['name']}{mod_str}")
        lines.append("    }\n")

    # Relationship connectors — rendered as 1-to-many (parent ||--o{ child)
    for rel in relationships:
        lines.append(
            f'    {rel["to_table"]} ||--o{{ {rel["from_table"]} : '
            f'"has ({rel["from_col"]}->{rel["to_col"]})"'
        )

    return "\n".join(lines)


# =============================================================================
# CLI Entry Point
# =============================================================================


def main():
    parser = argparse.ArgumentParser(
        prog="mermaid.py",
        description="Generate Mermaid ER diagrams from a Cloudflare D1 schema.",
        epilog="""
examples:
  # Generate from local D1 (default)
  pnpm run db:diagram

  # Generate from production D1
  pnpm run db:diagram:remote

  # Generate from migration files (no D1 connection needed)
  pnpm run db:diagram:migrations

  # Filter to specific tables with glob patterns (quote the wildcards!)
  pnpm run db:diagram:migrations -- --tables 'showroom_*' 'store_*'

  # Override rendering defaults for a wider, dark-themed diagram
  pnpm run db:diagram:migrations -- --theme dark --layout LR --min-width 350 --font-size 16

  # Direct invocation with all options
  python3 mermaid.py --from-migrations --tables 'budget_*' --theme dark --font-size 18
""",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    # ---- Data source ----
    source = parser.add_argument_group("data source")
    source.add_argument(
        "--db",
        default="DB",
        help="D1 database binding name (default: DB). Only used in live query mode.",
    )
    source.add_argument(
        "--remote",
        action="store_true",
        help="Query the production (remote) D1 instance.",
    )
    source.add_argument(
        "--local",
        action="store_true",
        help="Query the local wrangler dev sandbox (this is the default).",
    )
    source.add_argument(
        "--from-migrations",
        metavar="DIR",
        nargs="?",
        const="drizzle",
        help="Parse Drizzle migration .sql files from DIR instead of querying D1 (default: drizzle/).",
    )

    # ---- Filtering ----
    filtering = parser.add_argument_group("filtering")
    filtering.add_argument(
        "--tables",
        nargs="+",
        metavar="PATTERN",
        help="Table names or glob patterns to include (e.g. 'showroom_*' 'store_*'). Quote wildcards for zsh.",
    )

    # ---- Mermaid rendering ----
    rendering = parser.add_argument_group(
        "rendering",
        "Mermaid diagram appearance. These control the %%%%{init}%%%% directive.",
    )
    rendering.add_argument(
        "--theme",
        default=MERMAID_DEFAULTS["theme"],
        choices=["default", "dark", "forest", "neutral"],
        help=f"Mermaid color theme (default: {MERMAID_DEFAULTS['theme']}).",
    )
    rendering.add_argument(
        "--layout",
        default=MERMAID_DEFAULTS["layout"],
        choices=["TB", "LR"],
        help=f"Layout direction: TB=top-to-bottom, LR=left-to-right (default: {MERMAID_DEFAULTS['layout']}).",
    )
    rendering.add_argument(
        "--min-width",
        type=int,
        default=MERMAID_DEFAULTS["min_width"],
        metavar="PX",
        help=f"Minimum entity box width in pixels (default: {MERMAID_DEFAULTS['min_width']}).",
    )
    rendering.add_argument(
        "--padding",
        type=int,
        default=MERMAID_DEFAULTS["padding"],
        metavar="PX",
        help=f"Padding inside entity boxes in pixels (default: {MERMAID_DEFAULTS['padding']}).",
    )
    rendering.add_argument(
        "--font-size",
        type=int,
        default=MERMAID_DEFAULTS["font_size"],
        metavar="PX",
        help=f"Font size for attribute labels in pixels (default: {MERMAID_DEFAULTS['font_size']}).",
    )

    # Strip bare '--' from argv — pnpm inserts it when forwarding args via
    # `pnpm run script -- --flag`, and argparse chokes on it since we have
    # no positional args to absorb it.
    argv = [a for a in sys.argv[1:] if a != "--"]
    args = parser.parse_args(argv)

    # ---- Choose data source ----

    if args.from_migrations:
        # Offline mode: parse .sql migration files without a D1 connection
        migration_dir = Path(args.from_migrations)
        if not migration_dir.is_absolute():
            migration_dir = Path.cwd() / migration_dir

        print(f"🔄 Parsing migration files from: {migration_dir}...", file=sys.stderr)
        all_tables, all_fks = parse_migration_files(migration_dir)
    else:
        # Live mode: query D1 via wrangler CLI
        is_remote = args.remote if (args.remote or args.local) else False
        print(
            f"🔄 Extracting schema data from D1 bound as: {args.db} "
            f"({'Remote' if is_remote else 'Local'})...",
            file=sys.stderr,
        )
        all_tables = get_tables_and_columns(args.db, is_remote)
        all_fks = get_foreign_keys(args.db, all_tables, is_remote)

    # ---- Build mermaid config from CLI args ----

    mermaid_config = {
        "theme": args.theme,
        "layout": args.layout,
        "min_width": args.min_width,
        "padding": args.padding,
        "font_size": args.font_size,
    }

    mermaid_output = generate_mermaid(
        all_tables, all_fks,
        selected_tables=args.tables,
        mermaid_config=mermaid_config,
    )

    # Output goes next to this script: d1_schema/diagram/<timestamp>_diagram.md
    script_dir = Path(os.path.dirname(os.path.abspath(__file__)))
    diagram_dir = script_dir / "diagram"
    diagram_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_file = diagram_dir / f"{timestamp}_diagram.md"

    # Wrap in a mermaid code fence for Markdown rendering
    md_content = f"```mermaid\n{mermaid_output}\n```\n"
    output_file.write_text(md_content)

    print(f"✅ Diagram saved to: {output_file}", file=sys.stderr)


if __name__ == "__main__":
    main()
