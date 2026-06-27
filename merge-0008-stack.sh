#!/usr/bin/env bash
#
# merge-0008-stack.sh — merge the 0008 showroom-planner PR stack bottom-up,
# one at a time. Skips PRs that are already merged. Does NOT wait on the
# Cloudflare build/deploy — each merge to main kicks off its own deploy, which
# Cloudflare runs (and queues) on its side. Stops on a real conflict.
#
# Usage:  ./merge-0008-stack.sh
# Requires: gh (authenticated).

set -euo pipefail

REPO="jmbish04/core-remodel"
# PR numbers in merge order.
#   #45 = deploy hotfix (d1-migrate comment-only fix) — MUST go first.
#   #44 = replaces the auto-closed #36. Already-merged PRs (35, 44) are skipped.
ORDER=(45 35 44 37 38 40 41 43 39 42)

green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
red()   { printf '\033[0;31m%s\033[0m\n' "$1"; }
blue()  { printf '\033[0;34m%s\033[0m\n' "$1"; }

blue "Merging the 0008 stack: ${ORDER[*]}"
echo

for pr in "${ORDER[@]}"; do
  blue "=== PR #$pr ==="

  state=$(gh pr view "$pr" --repo "$REPO" --json state --jq '.state')
  if [ "$state" = "MERGED" ]; then
    green "  already merged — skipping."
    echo; continue
  fi
  if [ "$state" = "CLOSED" ]; then
    red "  CLOSED but not merged — skipping (check this PR manually)."
    echo; continue
  fi

  # Make sure it targets main (it should already).
  base=$(gh pr view "$pr" --repo "$REPO" --json baseRefName --jq '.baseRefName')
  if [ "$base" != "main" ]; then
    blue "  retargeting base ($base → main)…"
    gh pr edit "$pr" --repo "$REPO" --base main >/dev/null
  fi

  # main just moved under us from the previous merge, so GitHub needs a moment to
  # recompute mergeability. Wait for a definite answer (NOT for any build).
  mergeable="UNKNOWN"
  for _ in $(seq 1 30); do
    mergeable=$(gh pr view "$pr" --repo "$REPO" --json mergeable --jq '.mergeable')
    [ "$mergeable" = "MERGEABLE" ] && break
    [ "$mergeable" = "CONFLICTING" ] && break
    sleep 3
  done
  if [ "$mergeable" = "CONFLICTING" ]; then
    red "  CONFLICTING against main — resolve it, then re-run (already-merged PRs are skipped)."
    exit 1
  fi

  blue "  merging…"
  gh pr merge "$pr" --repo "$REPO" --merge
  green "  merged."
  echo
done

green "All PRs merged. Cloudflare is deploying each merge in the background —"
green "watch the Workers Builds dashboard, and smoke-test once the last deploy lands."
