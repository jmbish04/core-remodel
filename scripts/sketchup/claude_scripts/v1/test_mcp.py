import asyncio, httpx, subprocess
from mcp.client.streamable_http import streamable_http_client

async def main():
    r = subprocess.run(["tokens", "show", "TRIMBLE_API_KEY", "--value-only"], capture_output=True, text=True)
    tok = r.stdout.strip()
    print("Token length:", len(tok))
    hc = httpx.AsyncClient(headers={"Authorization": f"Bearer {tok}"})
    try:
        async with streamable_http_client(url="https://api.sketchup.com/mcp/v1/sketchup/mcp", http_client=hc) as (r,w,_):
            print("Success!")
    except Exception as e:
        print("Error:", e)

asyncio.run(main())
