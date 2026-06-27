import os
import subprocess
from pathlib import Path

# Try to load .env from the project root if dotenv is installed
try:
    from dotenv import load_dotenv
    current_dir = Path(__file__).resolve().parent
    env_path = None
    while current_dir != current_dir.parent:
        if (current_dir / ".env").exists():
            env_path = current_dir / ".env"
            break
        current_dir = current_dir.parent
    
    if env_path:
        load_dotenv(env_path)
except ImportError:
    pass

def get_secret(*keys):
    """
    Tries to retrieve a secret from the environment first,
    then falls back to the `tokens` CLI. Returns the first valid one found.
    """
    for key in keys:
        if key and os.getenv(key):
            val = os.getenv(key).strip()
            if val:
                return val
                
    for key in keys:
        if not key: continue
        try:
            r = subprocess.run(["tokens", "show", key, "--value-only"], capture_output=True, text=True, check=True)
            val = r.stdout.strip()
            if val:
                return val
        except (subprocess.CalledProcessError, FileNotFoundError):
            pass
    return ""

TRIMBLE_API_KEY = get_secret("TRIMBLE_API_KEY", "TRIMBLE_ACCESS_TOKEN")
