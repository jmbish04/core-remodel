"""Cloudflare side of the local product scraper: secrets, Workers AI, Images, D1.

Deliberately dependency-free (urllib + the wrangler binary already used by
scripts/) so this runs with the system python and no venv.

Secret resolution order, per key:
  1. process environment — set it there for CI or a one-off run;
  2. `tokens show <NAME>` — the operator's local encrypted token store.

`tokens show` prints the value on line 1 but also copies to the clipboard and
runs a live API check, so it is the fallback rather than the default: a batch
run would otherwise stomp the clipboard once per secret.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import urllib.error
import urllib.request
from functools import lru_cache
from typing import Any

#: Matches ANSI colour codes in `tokens` output.
_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")

#: Non-reasoning model. See memory `workers-ai-structured-output-gotchas`:
#: kimi-k2.6 burns its whole budget on reasoning_content and returns
#: `content: ""`. gpt-oss-120b answers the same prompt in ~7-10s.
EXTRACT_MODEL = "@cf/openai/gpt-oss-120b"

D1_DATABASE = "core-remodel"


class CloudflareError(RuntimeError):
    """A Cloudflare API call or secret lookup failed."""


# ---------------------------------------------------------------------------
# Secrets
# ---------------------------------------------------------------------------


@lru_cache(maxsize=None)
def secret(name: str, *, required: bool = True) -> str | None:
    """Resolve a secret from the environment, falling back to the tokens CLI."""
    from_env = os.environ.get(name, "").strip()
    if from_env:
        return from_env

    tokens_bin = os.path.expanduser("~/bin/tokens")
    if os.path.exists(tokens_bin):
        try:
            proc = subprocess.run(
                [tokens_bin, "show", name],
                capture_output=True,
                text=True,
                timeout=60,
            )
            first_line = _ANSI_RE.sub("", proc.stdout.splitlines()[0]).strip()
            if first_line and " " not in first_line:
                return first_line
        except (subprocess.SubprocessError, IndexError):
            pass

    if required:
        raise CloudflareError(
            f"secret {name} not found — export it or add it via `tokens set {name}`",
        )
    return None


# ---------------------------------------------------------------------------
# Workers AI (through the account's AI Gateway, so calls are logged + cached)
# ---------------------------------------------------------------------------


def _http_json(
    url: str,
    *,
    payload: dict[str, Any] | None = None,
    headers: dict[str, str],
    timeout: int = 180,
    data: bytes | None = None,
) -> dict[str, Any]:
    body = data if data is not None else (json.dumps(payload).encode() if payload else None)
    # urllib defaults to `Python-urllib/3.x`, which Cloudflare's WAF blocks with
    # a 403 error 1010 ("banned based on browser signature") before the request
    # ever reaches the gateway. Any ordinary UA gets through.
    headers = {"User-Agent": "core-remodel-product-intake/1.0", **headers}
    request = urllib.request.Request(url, data=body, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as err:
        detail = err.read().decode()[:400]
        raise CloudflareError(f"{url} -> HTTP {err.code}: {detail}") from err
    except urllib.error.URLError as err:
        raise CloudflareError(f"{url} unreachable: {err}") from err


def run_ai(
    messages: list[dict[str, str]],
    *,
    json_schema: dict[str, Any] | None = None,
    max_tokens: int = 4096,
    model: str = EXTRACT_MODEL,
) -> dict[str, Any] | str:
    """Call Workers AI through the AI Gateway.

    Returns a parsed object when `json_schema` is given, else the raw text.

    The envelope is NOT uniform across models: some answer on `.result.response`
    (object or JSON string), others in the OpenAI shape at
    `.result.choices[0].message.content`. Handling only one shape is how the
    production workflow silently produced all-null extractions for months — see
    src/backend/utils/ai-json.ts, which encodes the same rules server-side.
    """
    account = secret("CLOUDFLARE_ACCOUNT_ID")
    gateway = os.environ.get("CLOUDFLARE_AI_GATEWAY_ID", "core-remodel")

    # This gateway has authentication enabled, so TWO credentials are required
    # and they are not interchangeable:
    #   Authorization        -> a token with Workers AI permission
    #   cf-aig-authorization -> the gateway's own token
    # Sending only the first returns AiGatewayError 2009 "Unauthorized" (the
    # gateway rejecting); sending a Workers-AI-less token returns error 10000
    # "Authentication error" (Workers AI rejecting). The two look alike and
    # mean different things — measured 2026-07-19.
    ai_token = secret("CLOUDFLARE_OPENHUMAN_AIG_TOKEN", required=False) or secret(
        "CLOUDFLARE_API_TOKEN",
    )
    gateway_token = secret("CLOUDFLARE_AI_GATEWAY_TOKEN", required=False)

    url = (
        f"https://gateway.ai.cloudflare.com/v1/{account}/{gateway}"
        f"/workers-ai/{model}"
    )
    payload: dict[str, Any] = {"messages": messages, "max_tokens": max_tokens}
    if json_schema:
        payload["response_format"] = {"type": "json_schema", "json_schema": json_schema}

    headers = {
        "Authorization": f"Bearer {ai_token}",
        "Content-Type": "application/json",
    }
    if gateway_token:
        headers["cf-aig-authorization"] = f"Bearer {gateway_token}"

    body = _http_json(url, payload=payload, headers=headers)

    result = body.get("result", body)
    content = _unwrap_ai_content(result)

    if not json_schema:
        return content

    if not content.strip():
        # gpt-oss-120b also emits a `reasoning` field and will spend the whole
        # budget there on a long prompt, returning content:"" with
        # finish_reason:"length". Raising max_tokens is the fix; switching model
        # is not (kimi-k2.6 does this far worse — see the memory note).
        reason = ""
        if isinstance(result, dict):
            choice = (result.get("choices") or [{}])[0]
            finish = choice.get("finish_reason")
            spent = bool((choice.get("message") or {}).get("reasoning"))
            if finish == "length":
                reason = (
                    f" (finish_reason=length{', budget spent on reasoning' if spent else ''}"
                    f"; retry with max_tokens above {max_tokens})"
                )
        raise CloudflareError(f"{model} returned empty content{reason}")

    parsed = json.loads(_strip_fence(content))
    if not isinstance(parsed, dict):
        # "null" and "123" parse cleanly; treat as a failed extraction rather
        # than letting a primitive escape and crash the caller.
        raise CloudflareError(f"{model} returned a non-object: {type(parsed).__name__}")
    return parsed


def _unwrap_ai_content(result: Any) -> str:
    """Pull text out of whichever envelope this model uses."""
    if isinstance(result, str):
        return result
    if not isinstance(result, dict):
        return ""

    choices = result.get("choices")
    if isinstance(choices, list) and choices:
        message = choices[0].get("message") or {}
        content = message.get("content")
        if isinstance(content, str):
            return content

    response = result.get("response")
    if isinstance(response, str):
        return response
    if isinstance(response, dict):
        return json.dumps(response)
    return ""


def _strip_fence(text: str) -> str:
    """Strip ```json fences and any prose around the outermost brace pair."""
    stripped = re.sub(r"^```(?:json)?\s*", "", text.strip())
    stripped = re.sub(r"\s*```$", "", stripped).strip()
    first, last = stripped.find("{"), stripped.rfind("}")
    if first != -1 and last > first:
        return stripped[first : last + 1]
    return stripped


# ---------------------------------------------------------------------------
# Cloudflare Images
# ---------------------------------------------------------------------------


def upload_image(content: bytes, filename: str, metadata: dict[str, str]) -> str:
    """Upload bytes to Cloudflare Images, returning the public delivery URL."""
    account = secret("CLOUDFLARE_ACCOUNT_ID")
    token = secret("CLOUDFLARE_IMAGES_STREAM_TOKEN", required=False) or secret(
        "CLOUDFLARE_API_TOKEN",
    )

    boundary = "----productintake" + os.urandom(8).hex()
    parts: list[bytes] = []

    def field(name: str, value: str) -> None:
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n'
            f"{value}\r\n".encode(),
        )

    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; '
        f'filename="{filename}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode(),
    )
    parts.append(content)
    parts.append(b"\r\n")
    field("metadata", json.dumps(metadata))
    parts.append(f"--{boundary}--\r\n".encode())

    body = _http_json(
        f"https://api.cloudflare.com/client/v4/accounts/{account}/images/v1",
        data=b"".join(parts),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )

    if not body.get("success"):
        raise CloudflareError(f"image upload failed: {body.get('errors')}")

    variants = body["result"].get("variants") or []
    if not variants:
        raise CloudflareError("image uploaded but returned no variants")
    return variants[0]


# ---------------------------------------------------------------------------
# D1 — via the wrangler binary, matching the convention in scripts/
# ---------------------------------------------------------------------------


def d1_query(sql: str, *, remote: bool = True) -> list[dict[str, Any]]:
    """Run SQL against D1 and return result rows.

    Uses `wrangler d1 execute` rather than the REST API so this inherits the
    same auth the rest of the repo's tooling uses. Note the project rule: schema
    changes go through `pnpm run migrate:remote`, never ad-hoc DDL here.
    """
    command = [
        "npx",
        "wrangler",
        "d1",
        "execute",
        D1_DATABASE,
        "--json",
        f"--command={sql}",
    ]
    if remote:
        command.insert(5, "--remote")

    proc = subprocess.run(command, capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise CloudflareError(f"d1 query failed: {proc.stderr[-500:]}")

    match = re.search(r"\[\s*{.*}\s*\]", proc.stdout, re.S)
    if not match:
        return []
    payload = json.loads(match.group(0))
    return payload[0].get("results", []) if payload else []


def sql_escape(value: Any) -> str:
    """Render a Python value as a SQL literal.

    wrangler's --command takes no bind parameters, so values are inlined; every
    string goes through here. Note D1 caps a statement at 100 bound parameters
    anyway — see the brands 500 in PR #155 — so batch inserts are chunked by
    the caller.
    """
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"
