# Google Apps Script Clasp & Bidirectional Sync Standards
- Every spreadsheet layout component must map down to an explicit database backing field inside the Cloudflare D1 environment via Drizzle ORM to maintain strict persistence records.
- All spreadsheet row identifiers must be generated and managed as string data tokens (such as `brId_123`) to insulate business references from accidental numerical grid casting issues.
- Bidirectional spreadsheet updates must process across atomic transaction boundaries inside Hono API structures to safeguard transaction state parameters during heavy data synchronization loops.
- Avoid inline formula evaluations inside database records; preserve original tracking formula expressions (`=SUM(...)`) as uncalculated strings to leverage Google Sheets' calculation engine natively.
- Connect spreadsheet sidebars to the edge compute layer by running real-time WebSockets over the modern Cloudflare Agents SDK class framework, emitting automated tool JSON blocks down channels to execute client manipulations via `google.script.run`.
