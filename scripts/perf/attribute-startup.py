#!/usr/bin/env python3
"""Attribute a `wrangler check startup` CPU profile back to source modules.

Usage: python3 scripts/perf/attribute-startup.py <profile.cpuprofile> <bundle/_worker.js.map>

Uses the bundle's sourcemap rather than esbuild's `// path` banners. The banner
approach mis-attributes: esbuild does not emit one banner per module, so a
region gets credited to whichever banner happened to precede it.
"""
import json, sys, collections, re

B64 = {c: i for i, c in enumerate(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/")}

def vlq(seg):
    out, shift, val = [], 0, 0
    for ch in seg:
        d = B64[ch]
        val += (d & 31) << shift
        if d & 32:
            shift += 5
        else:
            v = val >> 1
            out.append(-v if val & 1 else v)
            shift, val = 0, 0
    return out

def load_map(path):
    m = json.load(open(path))
    sources = m["sources"]
    # generated line -> sorted list of (gen_col, source_index)
    per_line = {}
    src_i = 0
    for gl, group in enumerate(m["mappings"].split(";")):
        if not group:
            continue
        gc = 0
        entries = []
        for seg in group.split(","):
            if not seg:
                continue
            f = vlq(seg)
            gc += f[0]
            if len(f) >= 4:
                src_i += f[1]
                entries.append((gc, src_i))
        if entries:
            per_line[gl] = entries
    return sources, per_line

def bucket(src):
    s = src.replace("../", "")
    if "/node_modules/.pnpm/" in s:
        pkg = s.split("/node_modules/.pnpm/")[1].split("/node_modules/")[-1]
        top = pkg.split("/")[0]
        if top.startswith("@"):
            top = "/".join(pkg.split("/")[:2])
        if top == "zod":
            return "dep:zod"
        if top == "hono" or top.startswith("@hono"):
            return "dep:hono"
        return f"dep:{top}"
    if "src/backend/api/routes" in s:
        return "ours:backend routes"
    if "src/backend/mcp" in s:
        return "ours:mcp registry"
    if "src/backend/db" in s:
        return "ours:db schema"
    if "src/backend" in s:
        return "ours:backend other"
    if "src/frontend" in s or "/pages/" in s or ".astro" in s:
        return "ours:frontend"
    if "src/" in s:
        return "ours:other"
    return "other"

def main():
    prof = json.load(open(sys.argv[1]))
    sources, per_line = load_map(sys.argv[2])
    nodes = {n["id"]: n for n in prof["nodes"]}
    samples = prof["samples"]
    counts = collections.Counter(samples)

    buckets = collections.Counter()
    files = collections.Counter()
    total = len(samples)
    for nid, n in counts.items():
        cf = nodes[nid]["callFrame"]
        name = cf.get("functionName") or ""
        url = cf.get("url") or ""
        if not url.endswith("_worker.js"):
            buckets["runtime/gc" if name in ("(garbage collector)", "(program)", "(idle)", "(root)") else "runtime"] += n
            continue
        if name in ("(garbage collector)", "(program)", "(idle)", "(root)"):
            buckets["garbage collection" if "garbage" in name else "runtime"] += n
            continue
        gl = cf.get("lineNumber", -1)
        gc = cf.get("columnNumber", 0)
        ent = per_line.get(gl)
        if not ent:
            buckets["unattributed (no mapping)"] += n
            continue
        si = ent[0][1]
        for c, s in ent:
            if c <= gc:
                si = s
            else:
                break
        src = sources[si]
        buckets[bucket(src)] += n
        files[src.replace("../", "")] += n

    # GC frames carry no url; catch them by functionName across all nodes
    print(f"total samples: {total}\n")
    print("by bucket:")
    for b, n in buckets.most_common():
        print(f"  {100*n/total:6.2f}%  {n:5d}  {b}")
    print("\ntop 20 source files:")
    for f, n in files.most_common(20):
        short = re.sub(r".*/node_modules/", "", f)
        print(f"  {100*n/total:6.2f}%  {n:5d}  {short[:100]}")

main()
