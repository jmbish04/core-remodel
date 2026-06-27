#!/usr/bin/env bash
#
# merge-0008-stack.sh — merge the 0008 showroom-planner PR stack bottom-up,
# one at a time, waiting for each merge AND its production deploy (Workers Build)
# to finish before starting the next. Stops immediately on any failure.
#
# Order matters:
#   - linear UI chain first (each builds on the previous)
#   - then #39 (self-hosted research engine — carries migration 0054 + DO tag v11)
#   - then #42 (Deep Research portal — depends on #39's /cf-engine endpoint)
#
# Usage:  ./scripts/merge-0008-stack.sh
# Requires: gh (authenticated), jq.

set -euo pipefail

REPO="jmbish04/core-remodel"
# PR numbers in merge order.
ORDER=(35 36 37 38 40 41 43 39 42)
POLL_SECONDS=15
DEPLOY_TIMEOUT_SECONDS=1800

c_green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
c_red()   { printf '\033[0;31m%s\033[0m\n' "$1"; }
c_blue()  { printf '\033[0;34m%s\033[0m\n' "$1"; }

# Wait until the PR reports MERGED.
wait_merged() {
  local pr="$1"
  while true; do
    local state
    state=$(gh pr view "$pr" --repo "$REPO" --json state --jq '.state')
    case "$state" in
      MERGED) return 0 ;;
      CLOSED) c_red "PR #$pr is CLOSED without merge. Aborting."; exit 1 ;;
      *) sleep "$POLL_SECONDS" ;;
    esac
  done
}

# Wait until all check-runs on the given commit complete successfully.
# This is how we wait for the Cloudflare Workers Build (prod deploy) to finish.
wait_deploy() {
  local sha="$1"
  local waited=0
  c_blue "  Waiting for production deploy (check-runs on ${sha:0:7})…"
  while true; do
    # Counts of incomplete and failed check-runs.
    local json incomplete failed
    json=$(gh api "repos/$REPO/commits/$sha/check-runs" --jq '.check_runs')
    incomplete=$(echo "$json" | jq '[.[] | select(.status != "completed")] | length')
    failed=$(echo "$json" | jq '[.[] | select(.conclusion != null and (.conclusion | test("success|neutral|skipped") | not))] | length')

    if [ "$failed" -gt 0 ]; then
      c_red "  A check failed on ${sha:0:7}:"
      echo "$json" | jq -r '.[] | select(.conclusion != null and (.conclusion | test("success|neutral|skipped") | not)) | "    - \(.name): \(.conclusion) — \(.html_url)"'
      c_red "  Aborting so you can investigate (likely the deploy)."
      exit 1
    fi
    if [ "$incomplete" -eq 0 ]; then
      # 0 incomplete and 0 failed. If there are 0 checks at all, give CF a moment.
      local total
      total=$(echo "$json" | jq 'length')
      if [ "$total" -eq 0 ] && [ "$waited" -lt 120 ]; then
        sleep "$POLL_SECONDS"; waited=$((waited + POLL_SECONDS)); continue
      fi
      c_green "  Deploy/checks green on ${sha:0:7}."
      return 0
    fi

    if [ "$waited" -ge "$DEPLOY_TIMEOUT_SECONDS" ]; then
      c_red "  Timed out after ${DEPLOY_TIMEOUT_SECONDS}s waiting for checks on ${sha:0:7}. Aborting."
      exit 1
    fi
    sleep "$POLL_SECONDS"; waited=$((waited + POLL_SECONDS))
  done
}

c_blue "Merging the 0008 stack: ${ORDER[*]}"
echo

for pr in "${ORDER[@]}"; do
  c_blue "=== PR #$pr ==="

  state=$(gh pr view "$pr" --repo "$REPO" --json state --jq '.state')
  if [ "$state" = "MERGED" ]; then
    c_green "  Already merged. Skipping."
    echo
    continue
  fi

  # Retarget every PR onto main before merging (the stack was built on parent
  # branches; once a parent is in main, the dependent must merge into main).
  base=$(gh pr view "$pr" --repo "$REPO" --json baseRefName --jq '.baseRefName')
  if [ "$base" != "main" ]; then
    c_blue "  Retargeting base ($base → main)…"
    gh pr edit "$pr" --repo "$REPO" --base main >/dev/null
    sleep 3  # let GitHub recompute mergeability
  fi

  mergeable=$(gh pr view "$pr" --repo "$REPO" --json mergeable --jq '.mergeable')
  if [ "$mergeable" = "CONFLICTING" ]; then
    c_red "  PR #$pr has conflicts against main. Resolve it, then re-run. Aborting."
    exit 1
  fi

  c_blue "  Merging (merge commit)…"
  # --merge preserves the stacked history so already-merged parent commits are
  # recognized and not re-applied. Remove --delete-branch if you want to keep branches.
  gh pr merge "$pr" --repo "$REPO" --merge --delete-branch

  wait_merged "$pr"
  sha=$(gh pr view "$pr" --repo "$REPO" --json mergeCommit --jq '.mergeCommit.oid')
  c_green "  Merged as ${sha:0:7}."

  wait_deploy "$sha"
  c_green "  PR #$pr done."
  echo
done

c_green "All PRs merged and deployed. The 0008 showroom planner is live."
