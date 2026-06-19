#!/bin/bash
# backfill.sh — Seed the cabinets research into the Research Center
#
# Usage:
#   ./backfill.sh [BASE_URL]
#
# Example:
#   ./backfill.sh http://localhost:4321          # local dev
#   ./backfill.sh https://core-remodel.colby.so  # production

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_URL="${1:-http://localhost:4321}"
ENDPOINT="${BASE_URL}/api/admin/research/backfill"

# Read the research markdown
MARKDOWN_FILE="${SCRIPT_DIR}/Bay Area Cabinetry_ Walnut Finish Research.md"
WEBAPP_FILE="${SCRIPT_DIR}/web_app.html"

if [ ! -f "$MARKDOWN_FILE" ]; then
  echo "ERROR: Markdown file not found: $MARKDOWN_FILE"
  exit 1
fi

if [ ! -f "$WEBAPP_FILE" ]; then
  echo "ERROR: Webapp file not found: $WEBAPP_FILE"
  exit 1
fi

echo "📚 Backfilling cabinets research..."
echo "   Endpoint: $ENDPOINT"
echo ""

# Build the JSON payload using node to properly escape strings
node -e "
const fs = require('fs');
const path = require('path');

const markdown = fs.readFileSync(path.join('${SCRIPT_DIR}', 'Bay Area Cabinetry_ Walnut Finish Research.md'), 'utf-8');
const visualizerHtml = fs.readFileSync(path.join('${SCRIPT_DIR}', 'web_app.html'), 'utf-8');

const payload = JSON.stringify({
  topic: 'Dark Walnut Cabinetry Finishing & Bay Area Cabinet Manufacturers',
  prompt: \`First, research the various methods for achieving a dark walnut appearance on cabinetry, specifically evaluating staining and paint techniques on plywood, while detailing the pros, cons, and maintenance associated with each method to educate you for discussions with makers.
Second, conduct in-depth research on custom and semi-custom cabinet manufacturers in the San Francisco Bay Area, focusing on those using plywood construction, and gather detailed reviews, customer feedback, and performance ratings to help you shortlist the best options for your home.\`,
  researchPlan: \`(1) Research finishing techniques to achieve a dark walnut appearance on plywood cabinetry, specifically evaluating and comparing wood staining versus painting methods.
(2) Detail the pros, cons, and long-term maintenance requirements associated with each of these finishing methods to build a knowledge base for discussions with professionals.
(3) Find custom and semi-custom cabinet manufacturers operating in the San Francisco Bay Area that utilize plywood construction for their cabinetry.
(4) For each identified local cabinet manufacturer, gather:
(a) detailed customer reviews and feedback
(b) overall performance ratings
(c) their portfolio or expertise regarding dark walnut finishes
(5) Synthesize the findings to create a shortlist of the highest-rated Bay Area manufacturers that meet the plywood construction and finish requirements.\`,
  markdown: markdown,
  visualizerHtml: visualizerHtml,
});

process.stdout.write(payload);
" | curl -s -X POST \
  -H "Content-Type: application/json" \
  -d @- \
  "$ENDPOINT" | node -e "
const chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => {
  try {
    const resp = JSON.parse(Buffer.concat(chunks).toString());
    console.log(JSON.stringify(resp, null, 2));
    if (resp.sessionId) {
      console.log('');
      console.log('✅ Backfill complete!');
      console.log('   Session ID:', resp.sessionId);
      console.log('   Chunks:', resp.chunkCount);
      console.log('   Visualizer:', resp.hasVisualizer ? 'Yes' : 'No');
    } else if (resp.error) {
      console.error('❌ Backfill failed:', resp.error);
      process.exit(1);
    }
  } catch (e) {
    console.error('❌ Failed to parse response');
    console.error(Buffer.concat(chunks).toString());
    process.exit(1);
  }
});
"
