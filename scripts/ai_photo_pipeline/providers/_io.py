"""Shared IO helpers used by every provider module."""
import os
import subprocess
import requests

from .. import config

_genai_client = None


def _read(path):
    with open(path, "rb") as fh:
        return fh.read()


def _guess_mime(path):
    return "image/png" if str(path).lower().endswith(".png") else "image/jpeg"


def _download(url):
    resp = requests.get(url, timeout=120)
    resp.raise_for_status()
    return resp.content


def save_image(image_bytes, path):
    with open(path, "wb") as fh:
        fh.write(image_bytes)
    print(f"  saved {path}")


def ref(filename, label):
    """Build a (filepath, label) reference tuple if the file exists, else None."""
    path = os.path.join(config.base_dir, filename)
    return (path, label) if os.path.exists(path) else None


def _load_secret(name: str) -> str:
    """Load a secret via the ``tokens`` CLI.

    Calls ``tokens show <name> --value-only`` and returns the raw value.
    Falls back to ``os.environ[name]`` if the CLI is not available.
    """
    # Fast-path: already in env
    val = os.environ.get(name)
    if val:
        return val

    try:
        result = subprocess.run(
            ["tokens", "show", name, "--value-only"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0 and result.stdout.strip():
            val = result.stdout.strip()
            os.environ[name] = val  # cache for subsequent calls
            return val
    except FileNotFoundError:
        pass  # tokens CLI not installed
    except subprocess.TimeoutExpired:
        pass

    raise RuntimeError(
        f"Secret '{name}' not found. Set it via:\n"
        f"  tokens set {name}\n"
        f"  — or —\n"
        f"  export {name}=<value>"
    )


def _client():
    """Lazy-init Gemini client.  Loads ``GEMINI_API_KEY`` from the ``tokens`` CLI."""
    global _genai_client
    if _genai_client is None:
        api_key = _load_secret("GEMINI_API_KEY")
        from google import genai
        _genai_client = genai.Client(api_key=api_key)
    return _genai_client
