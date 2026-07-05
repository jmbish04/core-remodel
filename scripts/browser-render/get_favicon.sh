#!/bin/bash

# Ensure pup is installed for parsing HTML
if ! command -v pup &> /dev/null; then
    echo "Error: pup is required. (e.g., brew install pup)"
    exit 1
fi

ACCOUNT_ID=$(tokens show CLOUDFLARE_ACCOUNT_ID --value-only)
API_TOKEN=$(tokens show CLOUDFLARE_BROWSER_RENDER_TOKEN --value-only)
URL="https://davincimarble.com/"

echo "Fetching rendered HTML for $URL..."

# 1. Fetch the rendered HTML using the /content endpoint
HTML_CONTENT=$(curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/browser-rendering/content" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "'"${URL}"'",
    "gotoOptions": {
      "waitUntil": "networkidle2"
    }
}')

# Check if Cloudflare returned an error JSON instead of HTML
if echo "$HTML_CONTENT" | jq -e '.success == false' &> /dev/null; then
  echo "Error fetching content:"
  echo "$HTML_CONTENT" | jq .
  exit 1
fi

echo "Extracting favicon links..."

# 2. Parse the HTML using pup to find the favicon links
# This looks for <link rel="icon">, <link rel="shortcut icon">, and <link rel="apple-touch-icon">
echo "$HTML_CONTENT" | pup 'link[rel~="icon"] attr{href}'
echo "$HTML_CONTENT" | pup 'link[rel="apple-touch-icon"] attr{href}'