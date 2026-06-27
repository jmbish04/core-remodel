"""
End-to-end Python script connecting Gemini to the remote Trimble SketchUp MCP Server.
Ensure you have installed the required modern SDKs:
pip install "google-genai>=0.2.0" "mcp>=1.0.0" python-dotenv
"""
import asyncio
import os
import sys

from google import genai
from google.genai import types
from mcp import ClientSession
from mcp.client.sse import sse_client
from dotenv import load_dotenv

import subprocess

load_dotenv()

def get_secret(key_name: str, fallback_key: str = None) -> str:
    # Try environment variable
    val = os.getenv(key_name)
    if val:
        return val
    if fallback_key:
        val = os.getenv(fallback_key)
        if val:
            return val
            
    # Try the tokens CLI tool
    for k in [key_name, fallback_key]:
        if not k:
            continue
        try:
            result = subprocess.run(
                ["tokens", "show", k, "--value-only"],
                capture_output=True,
                text=True,
                check=True
            )
            ret_val = result.stdout.strip()
            if ret_val:
                return ret_val
        except (subprocess.CalledProcessError, FileNotFoundError):
            pass
            
    return ""

async def main():
    # Authenticate and set up environment using helper with CLI fallback
    trimble_token = get_secret("TRIMBLE_ACCESS_TOKEN", "TRIMBLE_API_KEY")
    gemini_api_key = get_secret("GEMINI_API_KEY")
    cf_account_id = get_secret("CF_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID")
    cf_gateway_id = get_secret("CF_GATEWAY_ID", "CLOUDFLARE_GATEWAY_ID")
    
    if not all([trimble_token, gemini_api_key]):
        print("Error: Missing required environment variables or tokens (TRIMBLE_ACCESS_TOKEN/TRIMBLE_API_KEY and GEMINI_API_KEY).")
        print("Please configure them in your environment, .env file, or store them via the tokens CLI.")
        sys.exit(1)

    # Apply Senior Engineer standards: Route AI calls through Cloudflare AI Gateway for observability
    http_opts = None
    if cf_account_id and cf_gateway_id:
        base_url = f"https://gateway.ai.cloudflare.com/v1/{cf_account_id}/{cf_gateway_id}/google-genai"
        http_opts = types.HttpOptions(base_url=base_url)

    # Initialize the modern Gemini Client
    client = genai.Client(api_key=gemini_api_key, http_options=http_opts)
    
    # Using the stateful chat helper for multi-turn interactions
    chat = client.chats.create(model="gemini-2.5-pro")

    mcp_url = "https://api.sketchup.com/mcp/v1/sketchup/mcp"
    headers = {"Authorization": f"Bearer {trimble_token}"}

    print(f"Connecting to Trimble SketchUp MCP at {mcp_url}...")
    
    # Establish Server-Sent Events (SSE) connection to the remote MCP Server
    async with sse_client(url=mcp_url, headers=headers) as (read_stream, write_stream):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            print("Connected to MCP Server successfully.")
            
            # Retrieve available tools from the SketchUp Connector
            mcp_tools_response = await session.list_tools()
            
            # Map MCP tools to Gemini Function Declarations
            gemini_tools = []
            for tool in mcp_tools_response.tools:
                gemini_tools.append(
                    types.Tool(
                        function_declarations=[
                            types.FunctionDeclaration(
                                name=tool.name,
                                description=tool.description,
                                parameters=tool.inputSchema
                            )
                        ]
                    )
                )

            config = types.GenerateContentConfig(tools=gemini_tools)
            print("Ready! You can start asking Gemini to build models (type 'exit' to quit).")

            while True:
                user_input = input("\nYou: ")
                if user_input.lower() in ['exit', 'quit']:
                    break

                # Dispatch prompt to Gemini with attached MCP tools
                response = chat.send_message(user_input, config=config)
                
                # Check for tool invocations
                if response.function_calls:
                    for fc in response.function_calls:
                        print(f"[System] Gemini is executing SketchUp tool: {fc.name}...")
                        
                        try:
                            # Forward the execution to the MCP Server
                            tool_result = await session.call_tool(
                                name=fc.name, 
                                arguments=fc.args
                            )
                            
                            # Pipe the result back into the LLM context
                            response = chat.send_message(
                                types.Part.from_function_response(
                                    name=fc.name,
                                    response={"content": tool_result}
                                ),
                                config=config
                            )
                        except Exception as e:
                            print(f"[Error] Failed to execute {fc.name}: {e}")
                            # Notify the model of the failure so it can recover
                            response = chat.send_message(
                                types.Part.from_function_response(
                                    name=fc.name,
                                    response={"error": str(e)}
                                ),
                                config=config
                            )
                
                print(f"\nGemini: {response.text}")

if __name__ == "__main__":
    asyncio.run(main())