#!/usr/bin/env python3

import os
import subprocess
import sys
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

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
    api_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/browser-rendering/content"
    
    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "url": target_url,
        "gotoOptions": {
            "waitUntil": "networkidle2"
        }
    }

    # 2. Fetch Rendered HTML
    print(f"Fetching rendered HTML for {target_url} via Cloudflare Browser Rendering...")
    try:
        response = requests.post(api_url, headers=headers, json=payload, timeout=60)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"HTTP Request failed: {e}", file=sys.stderr)
        if e.response is not None:
            print(f"Response: {e.response.text}", file=sys.stderr)
        sys.exit(1)

    # Cloudflare /content returns JSON: {"success": true, "result": "<html>..."}
    # on success, or {"success": false, ...} on failure.
    content_type = response.headers.get("Content-Type", "")
    if "application/json" in content_type:
        data = response.json()
        if not data.get("success"):
            print("Cloudflare API returned an error:", file=sys.stderr)
            print(data, file=sys.stderr)
            sys.exit(1)
        html_content = data.get("result", "")
    else:
        html_content = response.text
    
    # 3. Save HTML to file
    html_path = os.path.join(SCRIPT_DIR, "rendered_page.html")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_content)
    print(f"Saved rendered HTML → {html_path} ({len(html_content)} chars)\n")

    # 4. Parse HTML for Favicons
    print("Extracting favicon links...\n")
    soup = BeautifulSoup(html_content, "html.parser")
    
    # Find all <link> tags and filter for icon rels manually
    all_links = soup.find_all("link", rel=True)
    icon_links = []
    for tag in all_links:
        rels = [r.lower() for r in tag.get("rel", [])]
        if "icon" in rels or "apple-touch-icon" in rels:
            icon_links.append(tag)
    
    if not icon_links:
        print("No favicon links found in the rendered HTML.")
        return

    for link in icon_links:
        href = link.get("href")
        rel = link.get("rel")
        
        # Convert list of rels to a string for cleaner output
        rel_str = " ".join(rel) if isinstance(rel, list) else rel
        
        if not href:
            continue

        # Resolve relative URLs against the target
        full_url = urljoin(target_url, href)
        print(f"Found [rel=\"{rel_str}\"]: {full_url}")

        # Derive a filename from the URL path
        parsed = urlparse(full_url)
        path = parsed.path.strip("/")
        filename = os.path.basename(path) if path else "favicon"

        # Ensure the filename has an extension; default to .ico
        if "." not in filename:
            filename += ".ico"

        save_path = os.path.join(SCRIPT_DIR, filename)

        # Download and save
        try:
            img_resp = requests.get(full_url, timeout=30)
            img_resp.raise_for_status()
            with open(save_path, "wb") as f:
                f.write(img_resp.content)
            print(f"  ✅ Saved → {save_path} ({len(img_resp.content)} bytes)")
        except requests.exceptions.RequestException as e:
            print(f"  ⚠️  Failed to download {full_url}: {e}", file=sys.stderr)

if __name__ == "__main__":
    main()