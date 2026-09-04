#!/usr/bin/env python3
"""Find out where this Worker's STARTUP CPU actually goes, by module.

A Cloudflare Worker must parse and execute its global scope inside 1 second of
CPU. Exceed it and every deploy — production or preview, any branch — fails
validation with `Script startup exceeded CPU time limit [code: 10021]`, which is
how this repo lost a day in September 2026. `npx wrangler check startup` writes
a `.cpuprofile` of that window; this maps its samples back to the modules that
own them, so you can see which import to defer instead of guessing.

    pnpm run perf:startup                  # build, profile, and report
    pnpm run perf:startup -- band --runs 5 # how noisy is the number, really?
    pnpm run perf:startup -- compare before.cpuprofile after.cpuprofile

WHY A SOURCEMAP AND NOT ESBUILD'S BANNERS. The obvious approach is to read the
`// <path>` banners esbuild leaves in the bundle and credit each region to the
banner above it. That is wrong, and confidently wrong: esbuild does not emit one
banner per module, so a region is credited to whichever banner happened to
precede it. Done that way, this repo's MCP tool registry was reported at 0.0% of
startup when it was 13.1% — the second-largest single cost — and the resulting
write-up told the next engineer not to bother with it. Everything here goes
through the bundle's own sourcemap instead.

THREE VIEWS, AND THE ONE YOU ACTUALLY WANT.

  self       Which module's own code is executing. Honest, and usually useless:
             it says "zod", because zod is what runs when your schemas are
             constructed. It does not tell you whose schemas.

  inclusive  Which modules are ON THE STACK. This is the one that answers the
             real question — "what would deferring X buy me?" — because it
             charges a module for everything it causes. `api/index.ts` scored
             46.5% here while barely appearing in `self`.

  blame      Walk each sample's stack to the nearest frame in OUR code. Turns
             "zod is 25%" into "these seven route files are 25%".

Startup profiling is NOISY: five runs of identical code in this repo spanned
110-131 samples. Use `band` before quoting a percentage to two significant
figures, and read a single run as a direction, not a measurement.

No third-party dependencies — stdlib only, so it runs anywhere the repo does.
"""

from __future__ import annotations

import argparse
import collections
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

B64 = {c: i for i, c in enumerate(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/")}

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ── sourcemap ────────────────────────────────────────────────────────────────

def decode_vlq(segment: str) -> list[int]:
    """Base64 VLQ -> ints. One segment of a sourcemap `mappings` group."""
    out, shift, value = [], 0, 0
    for ch in segment:
        digit = B64[ch]
        value += (digit & 31) << shift
        if digit & 32:
            shift += 5
        else:
            magnitude = value >> 1
            out.append(-magnitude if value & 1 else magnitude)
            shift, value = 0, 0
    return out


class SourceMap:
    """Just enough of a sourcemap to answer "which source owns this position?"."""

    def __init__(self, path: str):
        raw = json.load(open(path, encoding="utf8"))
        self.sources: list[str] = raw["sources"]
        # generated line -> [(generated column, source index)], ascending by column
        self.by_line: dict[int, list[tuple[int, int]]] = {}
        source_index = 0
        for line_no, group in enumerate(raw["mappings"].split(";")):
            if not group:
                continue
            column = 0
            entries: list[tuple[int, int]] = []
            for segment in group.split(","):
                if not segment:
                    continue
                fields = decode_vlq(segment)
                column += fields[0]
                if len(fields) >= 4:
                    source_index += fields[1]
                    entries.append((column, source_index))
            if entries:
                self.by_line[line_no] = entries

    def source_for(self, line: int, column: int) -> str | None:
        entries = self.by_line.get(line)
        if not entries:
            return None
        # Last mapping at or before this column owns it.
        found = entries[0][1]
        for entry_column, index in entries:
            if entry_column <= column:
                found = index
            else:
                break
        return tidy(self.sources[found])


def tidy(source: str) -> str:
    """Strip the leading ../ hops and the absolute repo prefix off a source path."""
    cleaned = source.replace("../", "")
    marker = os.path.basename(REPO) + "/"
    if marker in cleaned:
        cleaned = cleaned.split(marker, 1)[1]
    return cleaned


def pnpm_package(source: str) -> str | None:
    """Package name from a pnpm store path.

    Derived from the `.pnpm/<dir>` name, NOT from the path after the inner
    `node_modules/` — some packages publish their sources at
    `node_modules/src/...` with no package folder (drizzle-orm does), which
    reads back as the package literally being called "src".

        .pnpm/zod@4.1.5/node_modules/zod/v4/core.js          -> zod
        .pnpm/drizzle-orm@0.33.0_@cloudflare+…/…/src/x.ts    -> drizzle-orm
        .pnpm/@hono+zod-openapi@1.0.0_hono@4/…               -> @hono/zod-openapi
    """
    # Anchored to a path boundary, not a literal "/" — `tidy()` strips the repo
    # prefix, so a real source often STARTS with "node_modules/.pnpm/" and a
    # leading-slash match silently misses every one of them.
    match = re.search(r"(?:^|/)node_modules/\.pnpm/([^/]+)/", source)
    if not match:
        return None
    directory = match.group(1)
    without_peers = directory.split("_", 1)[0]          # drop peer-dep suffixes
    name = without_peers.rsplit("@", 1)[0] or without_peers
    return name.replace("+", "/")                        # pnpm encodes scope / as +


def bucket(source: str) -> str:
    """Group a source path into something worth reading in a summary table."""
    package = pnpm_package(source)
    if package:
        return f"dep:{package}"
    if re.search(r"(?:^|/)node_modules/", source):
        return "dep:" + re.sub(r".*node_modules/", "", source).split("/")[0]
    for prefix, label in (
        ("src/backend/api/routes", "ours:backend routes"),
        ("src/backend/mcp", "ours:mcp registry"),
        ("src/backend/db", "ours:db schema"),
        ("src/backend/ai", "ours:ai agents"),
        ("src/backend/services", "ours:services"),
        ("src/backend", "ours:backend other"),
        ("src/frontend", "ours:frontend"),
        ("dist/_worker.js", "ours:frontend"),
        ("src/", "ours:other"),
    ):
        if source.startswith(prefix):
            return label
    return "other"


def is_ours(source: str) -> bool:
    return source.startswith("src/") or source.startswith("dist/_worker.js")


# ── profile ──────────────────────────────────────────────────────────────────

RUNTIME_FRAMES = {"(garbage collector)", "(program)", "(idle)", "(root)"}


class Profile:
    def __init__(self, path: str, smap: SourceMap):
        raw = json.load(open(path, encoding="utf8"))
        self.nodes = {n["id"]: n for n in raw["nodes"]}
        self.samples: list[int] = raw["samples"]
        self.total = len(self.samples)
        self.counts = collections.Counter(self.samples)
        self.parent: dict[int, int] = {}
        for node in raw["nodes"]:
            for child in node.get("children", []):
                self.parent[child] = node["id"]
        self.smap = smap
        self._source_cache: dict[int, str | None] = {}

    def source_of(self, node_id: int) -> str | None:
        """The source file owning a node's frame, or None for runtime frames."""
        if node_id in self._source_cache:
            return self._source_cache[node_id]
        frame = self.nodes[node_id]["callFrame"]
        name = frame.get("functionName") or ""
        url = frame.get("url") or ""
        result: str | None = None
        if name not in RUNTIME_FRAMES and url.endswith("_worker.js"):
            result = self.smap.source_for(frame.get("lineNumber", -1),
                                          frame.get("columnNumber", 0))
        self._source_cache[node_id] = result
        return result

    def stack(self, node_id: int) -> list[int]:
        chain, cursor = [], node_id
        while cursor is not None:
            chain.append(cursor)
            cursor = self.parent.get(cursor)
        return chain

    # -- the three views ------------------------------------------------------

    def by_bucket(self) -> collections.Counter:
        """Self time, grouped. Runtime frames kept visible — GC is the story."""
        out: collections.Counter = collections.Counter()
        for node_id, count in self.counts.items():
            name = self.nodes[node_id]["callFrame"].get("functionName") or ""
            if name == "(garbage collector)":
                out["garbage collection"] += count
                continue
            source = self.source_of(node_id)
            out[bucket(source) if source else "runtime / unattributed"] += count
        return out

    def self_time(self) -> collections.Counter:
        out: collections.Counter = collections.Counter()
        for node_id, count in self.counts.items():
            source = self.source_of(node_id)
            if source:
                out[source] += count
        return out

    def inclusive(self) -> collections.Counter:
        """Samples whose stack TOUCHES each module — what deferring it buys."""
        out: collections.Counter = collections.Counter()
        for node_id, count in self.counts.items():
            seen = {s for s in (self.source_of(n) for n in self.stack(node_id)) if s}
            for source in seen:
                out[source] += count
        return out

    def blame(self) -> tuple[collections.Counter, int]:
        """Nearest OUR-code ancestor. Returns (counter, samples with no our-code frame)."""
        out: collections.Counter = collections.Counter()
        unattributed = 0
        for node_id, count in self.counts.items():
            for frame in self.stack(node_id):
                source = self.source_of(frame)
                if source and is_ours(source):
                    out[source] += count
                    break
            else:
                unattributed += count
        return out, unattributed


# ── reporting ────────────────────────────────────────────────────────────────

def table(title: str, counter: collections.Counter, total: int, top: int) -> None:
    print(f"\n{title}")
    if not counter:
        print("  (nothing)")
        return
    for label, count in counter.most_common(top):
        print(f"  {100 * count / total:6.2f}%  {count:5d}  {shorten(label)}")


def shorten(label: str, width: int = 88) -> str:
    label = re.sub(r".*/node_modules/", "", label)
    return label if len(label) <= width else "…" + label[-(width - 1):]


def report(profile: Profile, view: str, top: int, as_json: bool) -> None:
    if as_json:
        blamed, unattributed = profile.blame()
        print(json.dumps({
            "totalSamples": profile.total,
            "byBucket": dict(profile.by_bucket().most_common()),
            "selfTime": dict(profile.self_time().most_common(top)),
            "inclusive": dict(profile.inclusive().most_common(top)),
            "blame": dict(blamed.most_common(top)),
            "blameUnattributed": unattributed,
        }, indent=2))
        return

    print(f"\ntotal samples: {profile.total}")
    if view in ("all", "bucket"):
        table("by bucket (self time)", profile.by_bucket(), profile.total, top)
    if view in ("all", "self"):
        table("self time, by source file", profile.self_time(), profile.total, top)
    if view in ("all", "inclusive"):
        table("INCLUSIVE — samples whose stack touches the module "
              "(what deferring it buys)", profile.inclusive(), profile.total, top)
    if view in ("all", "blame"):
        blamed, unattributed = profile.blame()
        table("blame — nearest frame in OUR code", blamed, profile.total, top)
        print(f"  {100 * unattributed / profile.total:6.2f}%  {unattributed:5d}  "
              "(no our-code frame on the stack: runtime, GC, esbuild prelude)")


# ── driving wrangler ─────────────────────────────────────────────────────────

def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, **kw)


def build_bundle(outdir: str) -> str:
    """`wrangler deploy --dry-run` for the bundle + its sourcemap. Returns map path."""
    assets = os.path.join(REPO, "dist", ".assetsignore")
    if os.path.isdir(os.path.join(REPO, "dist")) and not os.path.exists(assets):
        src = os.path.join(REPO, ".assetsignore")
        if os.path.exists(src):
            shutil.copyfile(src, assets)
    print("• building the bundle (wrangler deploy --dry-run)…", file=sys.stderr)
    result = run(["npx", "wrangler", "deploy", "--outdir", outdir, "--dry-run"])
    for line in result.stdout.splitlines():
        if "Total Upload" in line:
            print("  " + line.strip(), file=sys.stderr)
    smap = os.path.join(outdir, "_worker.js.map")
    if not os.path.exists(smap):
        sys.exit(f"no sourcemap at {smap}\n{result.stdout[-2000:]}{result.stderr[-2000:]}")
    return smap


def capture_profile(outfile: str) -> str:
    print("• profiling startup (wrangler check startup)…", file=sys.stderr)
    result = run(["npx", "wrangler", "check", "startup", "--outfile", outfile])
    if not os.path.exists(outfile):
        sys.exit(f"no profile written\n{result.stdout[-2000:]}{result.stderr[-2000:]}")
    return outfile


def find_sourcemap(explicit: str | None, stack: list) -> str:
    if explicit:
        return explicit
    for candidate in ("dist/_worker.js.map", "worker.js.map"):
        path = os.path.join(REPO, candidate)
        if os.path.exists(path):
            return path
    outdir = tempfile.mkdtemp(prefix="startup-bundle-")
    stack.append(outdir)
    return build_bundle(outdir)


def sample_count(path: str) -> int:
    return len(json.load(open(path, encoding="utf8"))["samples"])


# ── self-check ───────────────────────────────────────────────────────────────

def self_test() -> int:
    """Small runnable check on the parts that can be silently wrong."""
    assert decode_vlq("A") == [0]
    assert decode_vlq("C") == [1]
    assert decode_vlq("D") == [-1]
    assert decode_vlq("AAAA") == [0, 0, 0, 0]
    assert decode_vlq("gBAAA") == [16, 0, 0, 0], decode_vlq("gBAAA")

    assert bucket("src/backend/api/routes/rooms.ts") == "ours:backend routes"
    assert bucket("src/backend/mcp/registry.ts") == "ours:mcp registry"
    assert bucket("src/backend/db/schema/index.ts") == "ours:db schema"
    assert bucket("x/node_modules/.pnpm/zod@4.0.0/node_modules/zod/v4/core.js") == "dep:zod"
    assert pnpm_package("x/node_modules/.pnpm/@hono+zod-openapi@1.0.0_hono@4.9/node_modules/@hono/"
                        "zod-openapi/src/index.ts") == "@hono/zod-openapi"
    # The shape that made an earlier version report a package called "src":
    # drizzle publishes its sources at node_modules/src/... with no package folder.
    assert bucket("x/node_modules/.pnpm/drizzle-orm@0.33.0_@cloudflare+workers-types@4.1/"
                  "node_modules/src/sqlite-core/table.ts") == "dep:drizzle-orm"
    # And the shape a REAL profile actually carries: tidy() has already removed
    # the repo prefix, so there is no leading slash. A "/node_modules/.pnpm/"
    # substring test misses all of these — which is how the fix above passed its
    # own test while changing nothing in the report.
    assert bucket("node_modules/.pnpm/drizzle-orm@0.33.0_x@1/node_modules/src/"
                  "sqlite-core/table.ts") == "dep:drizzle-orm"
    assert bucket("node_modules/.pnpm/zod@4.1.5/node_modules/zod/v4/core.js") == "dep:zod"
    assert bucket("node_modules/.pnpm/@hono+zod-openapi@1.0.0_hono@4.9/node_modules/"
                  "@hono/zod-openapi/src/index.ts") == "dep:@hono/zod-openapi"

    assert is_ours("src/backend/api/index.ts")
    assert not is_ours("node_modules/zod/index.js")

    # Column resolution must pick the LAST mapping at or before the column —
    # getting this backwards silently attributes every frame to the first
    # mapping on its line, which looks plausible and is entirely wrong.
    smap = SourceMap.__new__(SourceMap)
    smap.sources = ["a.ts", "b.ts"]
    smap.by_line = {5: [(0, 0), (40, 1)]}
    assert smap.source_for(5, 0) == "a.ts"
    assert smap.source_for(5, 39) == "a.ts"
    assert smap.source_for(5, 40) == "b.ts"
    assert smap.source_for(5, 999) == "b.ts"
    assert smap.source_for(6, 0) is None

    print("self-test: all checks passed")
    return 0


# ── commands ─────────────────────────────────────────────────────────────────

def cmd_analyze(args, cleanup: list) -> int:
    smap = SourceMap(find_sourcemap(args.map, cleanup))
    report(Profile(args.profile, smap), args.view, args.top, args.json)
    return 0


def cmd_run(args, cleanup: list) -> int:
    outdir = tempfile.mkdtemp(prefix="startup-bundle-")
    cleanup.append(outdir)
    smap_path = args.map or build_bundle(outdir)
    profile_path = capture_profile(args.profile)
    report(Profile(profile_path, SourceMap(smap_path)), args.view, args.top, args.json)
    print(f"\nprofile: {profile_path}", file=sys.stderr)
    return 0


def cmd_compare(args, cleanup: list) -> int:
    # EACH profile needs the sourcemap of ITS OWN build. Line numbers in the
    # bundle shift whenever anything upstream of a module changes, so reading
    # both profiles through one map silently misattributes the newer one — the
    # first version of this command did exactly that and reported two lazily
    # mounted route modules as having grown by 13 percentage points, when
    # neither is on the startup path at all. Refusing is better than a
    # confident wrong answer; that is the whole premise of this script.
    if not (args.before_map and args.after_map):
        sys.exit(
            "compare needs a sourcemap per profile:\n"
            "  --before-map <bundle-at-that-commit>/_worker.js.map\n"
            "  --after-map  <bundle-at-this-commit>/_worker.js.map\n\n"
            "Keep the --outdir from each `wrangler deploy --dry-run` alongside its\n"
            "profile. If both profiles really came from the SAME bundle, pass the\n"
            "same path twice."
        )
    before = Profile(args.before, SourceMap(args.before_map))
    after = Profile(args.after, SourceMap(args.after_map))
    print(f"\nsamples: {before.total} -> {after.total} "
          f"({100 * (after.total - before.total) / max(before.total, 1):+.1f}%)")
    print("\nNOTE: startup profiling is noisy — see `band` before reading a small "
          "delta as a change.")

    before_incl, after_incl = before.inclusive(), after.inclusive()
    moved = {
        source: (
            100 * after_incl.get(source, 0) / after.total
            - 100 * before_incl.get(source, 0) / before.total
        )
        for source in set(before_incl) | set(after_incl)
    }
    ordered = sorted(moved.items(), key=lambda kv: kv[1])
    print("\nbiggest inclusive DROPS (what the change actually deferred)")
    for source, delta in ordered[:args.top]:
        if delta < -0.5:
            print(f"  {delta:+7.2f}pp  {shorten(source)}")
    print("\nbiggest inclusive RISES")
    for source, delta in reversed(ordered[-args.top:]):
        if delta > 0.5:
            print(f"  {delta:+7.2f}pp  {shorten(source)}")
    return 0


def cmd_band(args, cleanup: list) -> int:
    """Repeat the profile N times so a delta can be read against real variance."""
    counts = []
    for run_no in range(1, args.runs + 1):
        path = capture_profile(os.path.join(tempfile.gettempdir(),
                                            f"startup-band-{run_no}.cpuprofile"))
        counts.append(sample_count(path))
        print(f"  run {run_no}: {counts[-1]} samples", file=sys.stderr)
    low, high = min(counts), max(counts)
    mean = sum(counts) / len(counts)
    print(f"\n{args.runs} runs of the SAME code: {counts}")
    print(f"  min {low}  max {high}  mean {mean:.1f}  spread {high - low} "
          f"({100 * (high - low) / mean:.0f}% of mean)")
    print("\nA difference smaller than this spread is not a result. Quote a band.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--self-test", action="store_true",
                        help="run the built-in checks and exit")
    sub = parser.add_subparsers(dest="command")

    def shared(p):
        p.add_argument("--map", help="sourcemap path (default: build one)")
        p.add_argument("--view", default="all",
                       choices=["all", "bucket", "self", "inclusive", "blame"])
        p.add_argument("--top", type=int, default=20)
        p.add_argument("--json", action="store_true")

    p_run = sub.add_parser("run", help="build, profile, and report (default)")
    p_run.add_argument("--profile", default="worker-startup.cpuprofile")
    shared(p_run)

    p_analyze = sub.add_parser("analyze", help="report on an existing .cpuprofile")
    p_analyze.add_argument("profile")
    shared(p_analyze)

    p_compare = sub.add_parser("compare", help="diff two profiles by inclusive cost")
    p_compare.add_argument("before")
    p_compare.add_argument("after")
    p_compare.add_argument("--before-map", help="sourcemap of the BEFORE build")
    p_compare.add_argument("--after-map", help="sourcemap of the AFTER build")
    shared(p_compare)

    p_band = sub.add_parser("band", help="N runs of the same code, to size the noise")
    p_band.add_argument("--runs", type=int, default=5)

    args = parser.parse_args()
    if args.self_test:
        return self_test()

    cleanup: list[str] = []
    try:
        if args.command == "analyze":
            return cmd_analyze(args, cleanup)
        if args.command == "compare":
            return cmd_compare(args, cleanup)
        if args.command == "band":
            return cmd_band(args, cleanup)
        if args.command is None:
            args = parser.parse_args(["run"])
        return cmd_run(args, cleanup)
    finally:
        for path in cleanup:
            shutil.rmtree(path, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
