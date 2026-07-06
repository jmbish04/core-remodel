#!/bin/bash

# Ensure jq is installed for parsing the API responses
if ! command -v jq &> /dev/null; then
    echo "Error: jq is required. (e.g., brew install jq)"
    exit 1
fi

ACCOUNT_ID=$(tokens show CLOUDFLARE_ACCOUNT_ID --value-only)
API_TOKEN=$(tokens show CLOUDFLARE_BROWSER_RENDER_TOKEN --value-only)
BASE_URL="https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/browser-rendering/crawl"

LIMIT=150
DEPTH=2
EXPORT_FILE="scripts/browser-render/davinci_markdown.json"

echo "Initiating crawl job for davincimarble.com..."

# 1. Initiate the crawl
INIT_RESPONSE=$(curl -s -X POST "${BASE_URL}" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    "url": "https://davincimarble.com/",
    "crawlPurposes": ["search"],
    "limit": ${LIMIT},
    "depth": ${DEPTH},
    "formats": ["markdown"],
    "render": true,
    "maxAge": 7200,
    "source": "all",
    "options": {
      "includeExternalLinks": true,
      "includeSubdomains": true
    }
}")

# 2. Extract Job ID (Cloudflare returns the raw UUID string directly in .result here)
JOB_ID=$(echo "${INIT_RESPONSE}" | jq -r '.result')

if [ -z "${JOB_ID}" ] || [ "${JOB_ID}" == "null" ]; then
    echo "Failed to start crawl job. API Response:"
    echo "${INIT_RESPONSE}" | jq .
    exit 1
fi

echo "Job started successfully. ID: ${JOB_ID}"
echo -n "Polling for results..."

# 3. Poll until complete
while true; do
    # Appending ?limit=1 keeps the payload lightweight during polling
    STATUS_RESPONSE=$(curl -s -X GET "${BASE_URL}/${JOB_ID}?limit=1" \
      -H "Authorization: Bearer ${API_TOKEN}")
      
    # For GET requests, .result is an object containing the status
    STATUS=$(echo "${STATUS_RESPONSE}" | jq -r '.result.status // .status // "unknown"')
    
    if [[ "${STATUS}" == "completed" || "${STATUS}" == "success" ]]; then
        echo -e "\n\nCrawl complete! Fetching full payload and saving to davinci_markdown.json"
        # Fetch the full payload without limit=1
        curl -s -X GET "${BASE_URL}/${JOB_ID}" \
          -H "Authorization: Bearer ${API_TOKEN}" | jq . > ${EXPORT_FILE}
        break
    elif [[ "${STATUS}" == "errored" || "${STATUS}" == "cancelled_due_to_timeout" || "${STATUS}" == "cancelled_due_to_limits" || "${STATUS}" == "cancelled_by_user" ]]; then
        echo -e "\n\nJob failed or was cancelled! Final Status: ${STATUS}"
        echo "${STATUS_RESPONSE}" | jq .
        exit 1
    fi
    
    echo -n "."
    sleep 5
done
