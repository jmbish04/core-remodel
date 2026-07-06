#!/usr/bin/env python3

import subprocess
import requests
import sys

def get_token(token_name: str) -> str:
    """Execute the tokens CLI to fetch credentials securely."""
    try:
        cmd = ["tokens", "show", token_name, "--value-only"]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return result.stdout.strip()
    except subprocess.CalledProcessError as e:
        print(f"Error fetching {token_name}: {e.stderr}", file=sys.stderr)
        sys.exit(1)
    except FileNotFoundError:
        print("Error: The 'tokens' CLI tool was not found in your PATH.", file=sys.stderr)
        sys.exit(1)

def main():
    # 1. Fetch Credentials
    print("Fetching credentials...")
    account_id = get_token("CLOUDFLARE_ACCOUNT_ID")
    api_token = get_token("CLOUDFLARE_BROWSER_RENDER_TOKEN")
    
    if not account_id or not api_token:
        print("Failed to retrieve Cloudflare credentials. Exiting.", file=sys.stderr)
        sys.exit(1)

    target_url = "https://davincimarble.com/"
    output_filename = "advanced-screenshot.png"
    api_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/browser-rendering/screenshot"
    
    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json"
    }
    
    # 2. Build the payload exactly matching the curl request
    payload = {
        "url": target_url,
        "screenshotOptions": {
            "fullPage": True
        },
        "viewport": {
            "width": 1280,
            "height": 1080
        },
        "gotoOptions": {
            "waitUntil": "networkidle0",
            "timeout": 45000
        }
    }

    # 3. Fetch Screenshot
    print(f"Requesting full-page screenshot of {target_url}...")
    try:
        # We don't use a strict timeout here because networkidle0 + fullPage rendering can take time.
        # We rely on the Cloudflare API's internal timeout (45s) to dictate the max duration.
        response = requests.post(api_url, headers=headers, json=payload)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"HTTP Request failed: {e}", file=sys.stderr)
        if e.response is not None:
            print(f"Response: {e.response.text}", file=sys.stderr)
        sys.exit(1)

    # 4. Safely handle the response payload
    content_type = response.headers.get("Content-Type", "")
    
    if "application/json" in content_type:
        print("Cloudflare API returned an error:", file=sys.stderr)
        print(response.json(), file=sys.stderr)
        sys.exit(1)
        
    # Write the binary image data to disk
    with open(output_filename, "wb") as f:
        f.write(response.content)
        
    print(f"Screenshot successfully saved to {output_filename}")

if __name__ == "__main__":
    main()