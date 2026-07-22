/**
 * @fileoverview Minimal Markdown table reader.
 *
 * WHY NOT HTMLRewriter
 * --------------------
 * The three vendor pricing sources this fetches are `.md` / `.md.txt`
 * endpoints — they return **Markdown**, not HTML. `HTMLRewriter` is an HTML
 * parser; handed a Markdown document it finds no elements and matches nothing.
 * So the correct tool here is a table reader, which is also smaller and has no
 * dependency (no Cheerio, no marked).
 *
 * Handles the GitHub-flavoured table shape every one of these pages uses:
 *
 *   | Model | Input | Output |
 *   |-------|-------|--------|
 *   | gpt-4o | $2.50 | $10.00 |
 *
 * Tolerates: leading/trailing pipes or neither, alignment colons in the
 * separator row, inline backticks/bold/links in cells, and blank lines between
 * tables.
 */

export interface MarkdownTable {
  /** Lowercased, trimmed header cells — what callers match on. */
  headers: string[];
  /** Each row as a header→cell map, using the lowercased headers. */
  rows: Array<Record<string, string>>;
}

/** A separator row: `|---|:--:|---:|` (and the pipe-less variant). */
function isSeparator(line: string): boolean {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, "")));
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  if (!trimmed.includes("|")) return [];
  return trimmed.split("|").map((c) => c.trim());
}

/** Strip the inline markup vendors use inside price cells. */
export function cleanCell(cell: string): string {
  return cell
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // [label](href) → label
    .replace(/[`*_]/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every table in a Markdown document.
 *
 * Rows with a different cell count than the header are kept and padded rather
 * than dropped: a vendor adding a trailing "notes" column should not silently
 * empty the whole catalog.
 */
export function parseMarkdownTables(markdown: string): MarkdownTable[] {
  const lines = markdown.split(/\r?\n/);
  const tables: MarkdownTable[] = [];

  for (let i = 0; i < lines.length - 1; i++) {
    const headerCells = splitRow(lines[i]);
    if (headerCells.length < 2 || !isSeparator(lines[i + 1])) continue;

    const headers = headerCells.map((h) => cleanCell(h).toLowerCase());
    const rows: MarkdownTable["rows"] = [];

    let j = i + 2;
    for (; j < lines.length; j++) {
      const cells = splitRow(lines[j]);
      if (cells.length === 0) break;
      const row: Record<string, string> = {};
      headers.forEach((h, k) => {
        row[h] = cleanCell(cells[k] ?? "");
      });
      rows.push(row);
    }

    if (rows.length > 0) tables.push({ headers, rows });
    i = j - 1;
  }

  return tables;
}

/** First table whose headers contain all of `needles` (substring match). */
export function findTable(tables: MarkdownTable[], needles: string[]): MarkdownTable | undefined {
  return tables.find((t) =>
    needles.every((n) => t.headers.some((h) => h.includes(n.toLowerCase()))),
  );
}

/** Every table matching, since vendors split one price list across several. */
export function findTables(tables: MarkdownTable[], needles: string[]): MarkdownTable[] {
  return tables.filter((t) =>
    needles.every((n) => t.headers.some((h) => h.includes(n.toLowerCase()))),
  );
}

/**
 * Parse a price cell into USD per MILLION tokens.
 *
 * The unit is read from the cell itself, because a single vendor page mixes
 * conventions — OpenAI lists some models per 1K and others per 1M in the same
 * document, and silently treating "$0.005 / 1K" as a per-million rate
 * under-reports that model by 1000x.
 *
 * Returns null for "free", "N/A", "—", or anything unparseable. Null means
 * "unknown", which the caller must keep distinct from zero.
 */
export function parsePricePerMillion(raw: string, headerHint = ""): number | null {
  const cell = cleanCell(raw).toLowerCase();
  if (!cell || /^(n\/?a|-|—|–|free|included|contact)/.test(cell)) return null;

  const match = cell.match(/\$?\s*([\d,]+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;

  // Unit from the cell first, then the column header — some tables put
  // "per 1M tokens" only in the header and leave bare numbers in the cells.
  const context = `${cell} ${headerHint.toLowerCase()}`;
  if (/per\s*1\s*k|\/\s*1\s*k|per\s*1,000|per\s*thousand|1k tokens/.test(context)) {
    return value * 1000;
  }
  if (/per\s*1\s*m|\/\s*1\s*m|per\s*million|1m tokens|per\s*1,000,000/.test(context)) {
    return value;
  }
  // Unlabelled. Every one of these pages quotes per-million by default in 2026;
  // the sourceNote records that this assumption was applied so a wrong-looking
  // price is traceable to it rather than mysterious.
  return value;
}
