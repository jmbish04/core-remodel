#!/usr/bin/env python3
"""Daily Durable Object billing watchdog.

Queries the Cloudflare GraphQL Analytics API for per-namespace Durable Object
usage and prints a table with estimated cost. Exists so a runaway DO (the
RemodelOrchestrator cf_agents_schedules incident, 2026-07-19: ~3B rows read
per HOUR) is visible the same day instead of on the invoice.

Usage:
    export CLOUDFLARE_API_TOKEN=...          # needs Account Analytics:Read
    export CLOUDFLARE_ACCOUNT_ID=...         # optional, defaults below
    python3 scripts/do_billing_watch.py              # last 7 days
    python3 scripts/do_billing_watch.py --days 30
    python3 scripts/do_billing_watch.py --hourly     # today, hour by hour
    python3 scripts/do_billing_watch.py --json

Exit code 1 if any namespace crosses the alert threshold, so it can be cron'd.

ponytail: stdlib only (urllib), no deps, no venv. Rates are hardcoded from
Cloudflare's published pricing -- if they change, edit RATES.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone

DEFAULT_ACCOUNT_ID = "b3304b14848de15c72c24a14b0cd187d"
API = "https://api.cloudflare.com/client/v4"

# Cloudflare Workers Paid, SQLite-backed Durable Objects.
# https://developers.cloudflare.com/durable-objects/platform/pricing/
RATES = {
    "rows_read_per_million": 0.001,
    "rows_written_per_million": 1.00,
    "requests_per_million": 0.15,
}

# A healthy namespace here reads thousands of rows/day, not billions.
# The runaway peaked at 67B/day. 100M/day is ~1000x normal and still only ~$0.10,
# so this fires long before it costs real money.
ALERT_ROWS_READ_PER_DAY = 100_000_000


def api_token():
    token = os.environ.get("CLOUDFLARE_API_TOKEN") or os.environ.get("CF_API_TOKEN")
    if not token:
        sys.exit(
            "CLOUDFLARE_API_TOKEN not set.\n"
            "Create one at https://dash.cloudflare.com/profile/api-tokens\n"
            "Permissions needed: Account > Account Analytics > Read\n"
            "                    Account > Workers Scripts > Read"
        )
    return token


def request(url, token, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
        },
        method="POST" if data else "GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        sys.exit("HTTP {} from {}\n{}".format(e.code, url, e.read().decode()[:800]))


def namespace_names(account_id, token):
    """id -> 'script.ClassName'. Best effort; unknown ids fall back to the raw id."""
    names = {}
    for page in range(1, 11):
        url = "{}/accounts/{}/workers/durable_objects/namespaces?per_page=200&page={}".format(
            API, account_id, page
        )
        payload = request(url, token)
        results = payload.get("result") or []
        for ns in results:
            names[ns["id"]] = "{}.{}".format(
                ns.get("script", "?"), ns.get("class", "?")
            )
        if len(results) < 200:
            break
    return names


def graphql(token, query, variables):
    payload = request(
        API + "/graphql", token, {"query": query, "variables": variables}
    )
    if payload.get("errors"):
        sys.exit("GraphQL error: " + json.dumps(payload["errors"], indent=2))
    accounts = payload["data"]["viewer"]["accounts"] if "data" in payload else \
        payload["result"]["viewer"]["accounts"]
    return accounts[0] if accounts else {}


DAILY_QUERY = """
query($acct: String!, $start: Date!, $end: Date!) {
  viewer { accounts(filter: {accountTag: $acct}) {
    durableObjectsPeriodicGroups(
      limit: 5000
      filter: {date_geq: $start, date_leq: $end}
      orderBy: [date_ASC]
    ) {
      dimensions { date namespaceId }
      sum { rowsRead rowsWritten cpuTime }
    }
    durableObjectsInvocationsAdaptiveGroups(
      limit: 5000
      filter: {date_geq: $start, date_leq: $end}
      orderBy: [date_ASC]
    ) {
      dimensions { date namespaceId }
      sum { requests errors }
    }
  } }
}
"""

HOURLY_QUERY = """
query($acct: String!, $since: Time!) {
  viewer { accounts(filter: {accountTag: $acct}) {
    durableObjectsPeriodicGroups(
      limit: 5000
      filter: {datetimeHour_geq: $since}
      orderBy: [datetimeHour_ASC]
    ) {
      dimensions { datetimeHour namespaceId }
      sum { rowsRead rowsWritten cpuTime }
    }
  } }
}
"""


def cost(rows_read, rows_written, requests):
    return (
        rows_read / 1e6 * RATES["rows_read_per_million"]
        + rows_written / 1e6 * RATES["rows_written_per_million"]
        + requests / 1e6 * RATES["requests_per_million"]
    )


def human(n):
    for unit, div in (("B", 1e9), ("M", 1e6), ("K", 1e3)):
        if n >= div:
            return "{:.2f}{}".format(n / div, unit)
    return str(int(n))


def collect_daily(account_id, token, days):
    end = date.today()
    start = end - timedelta(days=days - 1)
    acct = graphql(
        token,
        DAILY_QUERY,
        {"acct": account_id, "start": start.isoformat(), "end": end.isoformat()},
    )

    # key: (date, namespaceId)
    rows = {}
    for g in acct.get("durableObjectsPeriodicGroups", []):
        k = (g["dimensions"]["date"], g["dimensions"]["namespaceId"])
        rows.setdefault(k, {"read": 0, "written": 0, "requests": 0, "errors": 0})
        rows[k]["read"] += g["sum"]["rowsRead"]
        rows[k]["written"] += g["sum"]["rowsWritten"]
    for g in acct.get("durableObjectsInvocationsAdaptiveGroups", []):
        k = (g["dimensions"]["date"], g["dimensions"]["namespaceId"])
        rows.setdefault(k, {"read": 0, "written": 0, "requests": 0, "errors": 0})
        rows[k]["requests"] += g["sum"]["requests"]
        rows[k]["errors"] += g["sum"]["errors"]
    return rows


def collect_hourly(account_id, token, hours):
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).strftime(
        "%Y-%m-%dT%H:00:00Z"
    )
    acct = graphql(token, HOURLY_QUERY, {"acct": account_id, "since": since})
    rows = {}
    for g in acct.get("durableObjectsPeriodicGroups", []):
        k = (g["dimensions"]["datetimeHour"], g["dimensions"]["namespaceId"])
        rows.setdefault(k, {"read": 0, "written": 0, "requests": 0, "errors": 0})
        rows[k]["read"] += g["sum"]["rowsRead"]
        rows[k]["written"] += g["sum"]["rowsWritten"]
    return rows


def report(rows, names, threshold, top):
    """Print per-bucket totals plus the worst offenders. Returns True if alerting."""
    buckets = {}
    for (bucket, ns), v in rows.items():
        buckets.setdefault(bucket, []).append((ns, v))

    alerting = []
    for bucket in sorted(buckets):
        entries = sorted(buckets[bucket], key=lambda e: -e[1]["read"])
        t_read = sum(v["read"] for _, v in entries)
        t_written = sum(v["written"] for _, v in entries)
        t_req = sum(v["requests"] for _, v in entries)
        print(
            "\n{}   rows read {:>9}   written {:>9}   est ${:.2f}".format(
                bucket, human(t_read), human(t_written), cost(t_read, t_written, t_req)
            )
        )
        for ns, v in entries[:top]:
            if v["read"] == 0 and v["written"] == 0:
                continue
            flag = ""
            if v["read"] >= threshold:
                flag = "  <== RUNAWAY"
                alerting.append((bucket, names.get(ns, ns), v["read"]))
            err = ""
            if v["errors"]:
                err = "  err={}".format(v["errors"])
            print(
                "    {:<48} read {:>9}  written {:>8}  ${:.2f}{}{}".format(
                    names.get(ns, ns)[:48],
                    human(v["read"]),
                    human(v["written"]),
                    cost(v["read"], v["written"], v["requests"]),
                    err,
                    flag,
                )
            )

    print("\n" + "-" * 78)
    if alerting:
        print("ALERT: {} namespace-period(s) over {} rows read:".format(
            len(alerting), human(threshold)))
        for bucket, name, read in alerting:
            print("  {}  {}  {}".format(bucket, name, human(read)))
    else:
        print("OK: no namespace exceeded {} rows read.".format(human(threshold)))
    print("Costs are ESTIMATES at published rates and ignore free-tier allowances.")
    return bool(alerting)


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--days", type=int, default=7, help="days of daily history (default 7)")
    p.add_argument("--hourly", action="store_true", help="hour-by-hour instead of daily")
    p.add_argument("--hours", type=int, default=24, help="hours to show with --hourly")
    p.add_argument("--top", type=int, default=8, help="namespaces per period (default 8)")
    p.add_argument("--threshold", type=int, default=ALERT_ROWS_READ_PER_DAY,
                   help="alert above this many rows read per period")
    p.add_argument("--account", default=os.environ.get("CLOUDFLARE_ACCOUNT_ID",
                                                       DEFAULT_ACCOUNT_ID))
    p.add_argument("--json", action="store_true", help="raw JSON instead of a table")
    args = p.parse_args()

    token = api_token()
    names = namespace_names(args.account, token)

    if args.hourly:
        rows = collect_hourly(args.account, token, args.hours)
    else:
        rows = collect_daily(args.account, token, args.days)

    if args.json:
        print(json.dumps(
            [{"period": b, "namespace": names.get(n, n), **v}
             for (b, n), v in sorted(rows.items())],
            indent=2))
        return 0

    print("Durable Object usage - account {}".format(args.account))
    return 1 if report(rows, names, args.threshold, args.top) else 0


def _selftest():
    """ponytail: one runnable check on the only real logic here -- cost + alerting."""
    assert abs(cost(1_000_000, 0, 0) - 0.001) < 1e-9
    assert abs(cost(0, 1_000_000, 0) - 1.00) < 1e-9
    assert human(49_225_797_098) == "49.23B"
    assert human(42) == "42"
    # The real incident: 49.2B rows read in a day must alert.
    incident = {("2026-07-19", "ns1"): {"read": 49_225_797_098, "written": 1_635_062,
                                        "requests": 47_000, "errors": 22_000}}
    assert report(incident, {"ns1": "core-remodel.RemodelOrchestrator"},
                  ALERT_ROWS_READ_PER_DAY, 8) is True
    # A healthy day must not.
    healthy = {("2026-07-20", "ns1"): {"read": 2_100, "written": 300,
                                       "requests": 6, "errors": 0}}
    assert report(healthy, {"ns1": "core-remodel.RemodelOrchestrator"},
                  ALERT_ROWS_READ_PER_DAY, 8) is False
    print("\nselftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
    else:
        sys.exit(main())
