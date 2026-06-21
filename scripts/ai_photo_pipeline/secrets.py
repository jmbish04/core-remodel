"""Credential resolution.

Each secret is read from the environment, falling back to the ``tokens`` CLI
(``tokens show <name> --value-only``) exactly as the original script does.
"""

import os
import subprocess


def _get_token(name):
    """Fetch a secret from the env or the ``tokens show <name> --value-only`` CLI."""
    if name in os.environ:
        return os.environ[name]
    try:
        result = subprocess.run(
            ["tokens", "show", name, "--value-only"],
            capture_output=True, text=True, check=True,
        )
        return result.stdout.strip()
    except Exception as exc:
        print(f"  could not fetch {name}: {exc}")
        return None


def get_gemini_api_key():
    """GEMINI_API_KEY via env or the tokens CLI."""
    return _get_token("GEMINI_API_KEY")


def get_fal_key():
    """FAL_API_KEY via env or the tokens CLI."""
    return _get_token("FAL_API_KEY")


def get_replicate_token():
    """REPLICATE_API_TOKEN via env or the tokens CLI."""
    return _get_token("REPLICATE_API_TOKEN")


def get_openai_key():
    """OPENAI_API_KEY via env or the tokens CLI."""
    return _get_token("OPENAI_API_KEY")
