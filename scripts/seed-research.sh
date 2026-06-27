#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# seed-research.sh — Seed the Research Center with example data
#
# This script:
#   1. Inserts a research_sessions record into D1 (remote)
#   2. Uploads the research markdown to R2
#   3. Uploads the visualizer HTML to R2
#   4. Updates the D1 record with R2 keys and status=complete
#
# Usage:
#   chmod +x scripts/seed-research.sh
#   ./scripts/seed-research.sh
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# Configuration
DB_NAME="core-remodel"
R2_BUCKET="core-remodel-artifacts"
TOPIC="San Francisco Kitchen Remodel Showrooms — Natural Stone, Cabinets, Appliances"
PROOFS_DIR="proofs/research_app"
MD_FILE="${PROOFS_DIR}/San Francisco Kitchen Remodel Showrooms.txt"
HTML_FILE="${PROOFS_DIR}/San Francisco Kitchen Remodel Showrooms.html"

echo "🔬 Seeding Research Center with example data..."
echo ""

# ── Step 1: Check that proof files exist ──────────────────────────────────────
if [[ ! -f "$MD_FILE" ]]; then
  echo "❌ Research findings not found at: $MD_FILE"
  exit 1
fi

if [[ ! -f "$HTML_FILE" ]]; then
  echo "❌ Visualizer HTML not found at: $HTML_FILE"
  exit 1
fi

echo "✅ Found research files:"
echo "   📄 Markdown: $(wc -c < "$MD_FILE" | tr -d ' ') bytes"
echo "   🌐 Visualizer: $(wc -c < "$HTML_FILE" | tr -d ' ') bytes"
echo ""

# ── Step 2: Insert D1 record ─────────────────────────────────────────────────
echo "📝 Inserting research_sessions record into D1 (remote)..."

# Escape single quotes in the topic for SQL
ESCAPED_TOPIC=$(echo "$TOPIC" | sed "s/'/''/g")

INSERT_SQL="INSERT INTO research_sessions (topic, status, r2_markdown_key, r2_webapp_key, vector_namespace, chunk_count, created_at, completed_at) VALUES ('${ESCAPED_TOPIC}', 'complete', 'research/1/report.md', 'research/1/visualizer.html', 'research:1', 25, unixepoch(), unixepoch());"

pnpm dlx wrangler d1 execute "$DB_NAME" --remote --command "$INSERT_SQL"

echo "✅ D1 record inserted"
echo ""

# ── Step 3: Upload markdown to R2 ────────────────────────────────────────────
echo "📤 Uploading research markdown to R2..."

pnpm dlx wrangler r2 object put "${R2_BUCKET}/research/1/report.md" \
  --file "$MD_FILE" \
  --content-type "text/markdown" \
  --remote

echo "✅ Markdown uploaded to R2: research/1/report.md"
echo ""

# ── Step 4: Upload visualizer HTML to R2 ──────────────────────────────────────
echo "📤 Uploading visualizer HTML to R2..."

pnpm dlx wrangler r2 object put "${R2_BUCKET}/research/1/visualizer.html" \
  --file "$HTML_FILE" \
  --content-type "text/html" \
  --remote

echo "✅ Visualizer uploaded to R2: research/1/visualizer.html"
echo ""

# ── Done ──────────────────────────────────────────────────────────────────────
echo "🎉 Research Center seeded successfully!"
echo ""
echo "   View it at: /admin/research"
echo "   Detail at:  /admin/research/1"
echo ""
