"""Minimal JSON-RPC client for the local BrowserOS MCP server.

BrowserOS is a Chromium build with an agentic MCP layer, running locally and
signed in as the operator. That last part is the whole point: manufacturer and
dealer sites routinely serve a challenge page or a stripped catalogue to
headless/datacenter clients, so a logged-in local profile gets pages that
Cloudflare Browser Rendering cannot.

We speak to the MCP endpoint directly rather than shelling out to
`browseros-cli`. The CLI is a thin wrapper over this same endpoint, and on this
machine it is version-skewed against the server (v0.2.2 calls `new_page`; the
server exposes a consolidated `tabs` tool and answers `Tool new_page not
found`). Talking HTTP means no binary version coupling, no stdout parsing, and
no clipboard side-effects.

Server default: http://127.0.0.1:9200/mcp — launched by the
com.humuf.browseros LaunchAgent (~/bin/chrome-mcp/scripts/run-browseros.sh).

SECURITY — page content is untrusted input. BrowserOS wraps extracted content
in `[UNTRUSTED_PAGE_CONTENT nonce=... origin=...]` markers precisely because a
scraped page may contain text aimed at whatever model reads it next. Those
markers are preserved by `read()`; use `strip_untrusted_banner()` only when
storing to disk, and keep them when handing content to a model. Never treat
scraped text as instructions.
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

DEFAULT_SERVER = "http://127.0.0.1:9200/mcp"

#: Leading banner BrowserOS prepends to extracted content.
_UNTRUSTED_RE = re.compile(
    r"^\[UNTRUSTED_PAGE_CONTENT nonce=[0-9a-f]+ origin=[^\]]*\][^\n]*\n?",
)

#: Matching trailing sentinel. `evaluate` output is fenced on BOTH sides, so a
#: leading-only strip leaves `...}\n[END_UNTRUSTED_PAGE_CONTENT nonce=...]`
#: appended to the payload and every JSON parse of an eval result fails.
_UNTRUSTED_END_RE = re.compile(
    r"\n?\[END_UNTRUSTED_PAGE_CONTENT nonce=[0-9a-f]+\]\s*$",
)


class BrowserOSError(RuntimeError):
    """A BrowserOS MCP call failed, or the server is not reachable."""


def strip_untrusted_banner(text: str) -> str:
    """Drop both UNTRUSTED_PAGE_CONTENT sentinels.

    For storage and for parsing machine output (JSON from `evaluate`) only —
    never before handing prose to a model, where the marker is the entire
    safety mechanism.
    """
    without_head = _UNTRUSTED_RE.sub("", text, count=1)
    return _UNTRUSTED_END_RE.sub("", without_head).strip()


@dataclass
class BrowserOS:
    """Thin synchronous MCP client. One instance per scrape run."""

    server: str = DEFAULT_SERVER
    timeout: int = 120
    _next_id: int = 1

    # -- transport ---------------------------------------------------------

    def call(self, tool: str, arguments: dict[str, Any] | None = None) -> str:
        """Invoke an MCP tool, returning its first text content block.

        Raises BrowserOSError on transport failure or an `isError` result —
        the server reports tool-level failures in-band with HTTP 200, so the
        payload must be inspected rather than trusting the status code.
        """
        payload = {
            "jsonrpc": "2.0",
            "id": self._next_id,
            "method": "tools/call",
            "params": {"name": tool, "arguments": arguments or {}},
        }
        self._next_id += 1

        request = urllib.request.Request(
            self.server,
            data=json.dumps(payload).encode(),
            headers={
                "Content-Type": "application/json",
                # The server negotiates SSE for streaming tools; it will still
                # answer plain JSON, but it rejects a request that accepts
                # neither.
                "Accept": "application/json, text/event-stream",
            },
        )

        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                body = json.loads(response.read().decode())
        except urllib.error.URLError as err:
            raise BrowserOSError(
                f"cannot reach BrowserOS at {self.server} — is the app running? "
                f"({err})",
            ) from err

        if "error" in body:
            raise BrowserOSError(f"{tool}: {body['error']}")

        result = body.get("result", {})
        blocks = result.get("content") or []
        text = blocks[0].get("text", "") if blocks else ""

        if result.get("isError"):
            raise BrowserOSError(f"{tool}: {text}")

        return text

    # -- tabs --------------------------------------------------------------

    def open_page(self, url: str, *, hidden: bool = False) -> int:
        """Open `url` in a new tab and return its page id.

        `background=True` keeps focus on whatever the operator is doing — the
        point of running locally is that they can watch, not be interrupted.
        `hidden=True` puts it in a hidden window for unattended batches.
        """
        reply = self.call(
            "tabs",
            {"action": "new", "url": url, "background": True, "hidden": hidden},
        )
        match = re.search(r"page (\d+)", reply)
        if not match:
            raise BrowserOSError(f"could not parse page id from: {reply!r}")
        return int(match.group(1))

    def close_page(self, page: int) -> None:
        """Close a tab. Never raises — cleanup must not mask a real error."""
        try:
            self.call("tabs", {"action": "close", "page": page})
        except BrowserOSError:
            pass

    # -- observation -------------------------------------------------------

    def read(
        self,
        page: int,
        *,
        fmt: str = "markdown",
        include_images: bool = False,
        include_links: bool = False,
        selector: str | None = None,
    ) -> str:
        """Extract page content. fmt: markdown | text | links."""
        args: dict[str, Any] = {"page": page, "format": fmt}
        if include_images:
            args["includeImages"] = True
        if include_links:
            args["includeLinks"] = True
        if selector:
            args["selector"] = selector
        return self.call("read", args)

    def evaluate(self, page: int, code: str) -> str:
        """Run JavaScript via CDP Runtime.evaluate and return the result text.

        Used for the things markdown extraction loses: absolute image srcs,
        og: metadata, favicon hrefs. The reply is fenced in untrusted-content
        sentinels like every other extraction, so they are stripped here —
        callers expect the bare return value.
        """
        return strip_untrusted_banner(self.call("evaluate", {"page": page, "code": code}))

    def screenshot(self, page: int, *, full_page: bool = True) -> str:
        """Capture a screenshot. Returns the server's text reply (a saved-file
        path or inline payload depending on server version)."""
        return self.call(
            "screenshot",
            {"page": page, "format": "jpeg", "quality": 80, "fullPage": full_page},
        )

    def settle(
        self,
        page: int,
        *,
        min_chars: int = 400,
        max_seconds: float = 20.0,
        poll_seconds: float = 2.0,
    ) -> int:
        """Wait until the page has actually rendered, returning its char count.

        Product pages are overwhelmingly client-rendered; reading too early
        returns the pre-hydration shell (a real run against a catalogue site
        yielded 7 characters). A fixed pause is a guess that is either too slow
        or too short, so poll the extracted length until it stops growing.

        Note `wait`'s `value` is MILLISECONDS — passing seconds silently
        produces a ~2ms pause, which is what made this look like it worked.
        """
        previous = -1
        deadline = time.monotonic() + max_seconds

        while time.monotonic() < deadline:
            try:
                current = len(self.read(page, fmt="markdown"))
            except BrowserOSError:
                current = 0

            # Stable and non-trivial: rendered. Growing: still hydrating.
            if current >= min_chars and current == previous:
                return current
            previous = current
            time.sleep(poll_seconds)

        return max(previous, 0)

    def health(self) -> bool:
        """True when the server answers a tools/list handshake."""
        try:
            self.call("tabs", {"action": "list"})
            return True
        except BrowserOSError:
            return False
