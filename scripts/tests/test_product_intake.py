#!/usr/bin/env python3
"""Run: python3 scripts/tests/test_product_intake.py

Offline guards for the local BrowserOS product scraper. Every case here is a
bug that actually occurred while building it against the live server, so these
are regressions, not hypotheticals. No network, no browser.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "product_intake"))

from browseros_client import strip_untrusted_banner  # noqa: E402
from scrape_product import (  # noqa: E402
    _MD_IMAGE_RE,
    merge_unit_rows,
    parse_markdown_links,
)

# --- untrusted-content sentinels ------------------------------------------
# `evaluate` fences its reply on BOTH sides. Stripping only the leading banner
# left "[END_UNTRUSTED_PAGE_CONTENT nonce=...]" glued to the payload, so every
# JSON parse of an eval result failed and each page yielded zero assets.
fenced = (
    "[UNTRUSTED_PAGE_CONTENT nonce=64ef16d4da8b5849 origin=https://x.test] "
    "Untrusted page content follows.\n"
    '{"images":["https://cdn.test/a.jpg"],"title":"Goccia"}\n'
    "[END_UNTRUSTED_PAGE_CONTENT nonce=64ef16d4da8b5849]"
)
assert strip_untrusted_banner(fenced) == '{"images":["https://cdn.test/a.jpg"],"title":"Goccia"}'

# Content with no sentinels must pass through untouched.
assert strip_untrusted_banner('{"a":1}') == '{"a":1}'

# --- link extraction -------------------------------------------------------
links = parse_markdown_links(
    "[Spec sheet](https://x.test/a.pdf)\n"
    "[Home](https://x.test/)\n"
    "[Dup](https://x.test/a.pdf)\n"
    "[Relative](/nope)\n"
    "[Anchor](#section)",
)
urls = [link["url"] for link in links]
assert urls == ["https://x.test/a.pdf", "https://x.test/"], urls
assert links[0]["label"] == "Spec sheet"

# --- markdown image fallback ----------------------------------------------
found = _MD_IMAGE_RE.findall(
    "![null](https://cdn.test/hero.svg) text ![](https://cdn.test/b.webp)",
)
assert found == ["https://cdn.test/hero.svg", "https://cdn.test/b.webp"], found

# --- unit-row merging ------------------------------------------------------
# Models keep splitting a measurement across two rows despite the prompt
# forbidding it, so this is fixed deterministically instead.
merged = merge_unit_rows(
    [
        {"key": "Spout projection", "value": "9-7/8", "unit": None},
        {"key": "Spout projection unit", "value": "in", "unit": None},
        {"key": "Flow rate", "value": "1.2", "unit": None},
        {"key": "Flow rate unit", "value": "GPM", "unit": None},
        {"key": "Material", "value": "Solid brass", "unit": None},
    ],
)
assert [s["key"] for s in merged] == ["Spout projection", "Flow rate", "Material"], merged
assert merged[0]["unit"] == "in"
assert merged[1]["unit"] == "GPM"
assert merged[2]["unit"] is None

# An existing unit wins over a stray "<X> unit" row.
kept = merge_unit_rows(
    [
        {"key": "Width", "value": "24", "unit": "in"},
        {"key": "Width unit", "value": "cm", "unit": None},
    ],
)
assert len(kept) == 1 and kept[0]["unit"] == "in", kept

# An orphan "<X> unit" row with no parent is preserved rather than silently
# dropped — losing a spec is worse than an ugly key.
orphan = merge_unit_rows([{"key": "Torque unit", "value": "Nm", "unit": None}])
assert len(orphan) == 1, orphan

print("product intake guards: OK")
