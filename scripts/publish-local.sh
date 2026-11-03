#!/usr/bin/env bash
# Builds the committed state of the repo (HEAD, never uncommitted edits) into
# $MUSICMAN_BUILDS/<version>-<commit> and points $MUSICMAN_BUILDS/../current at it, so the musicman
# alias can run a stable build while the repo is being changed. Run by the post-commit hook after every
# commit; keeps the newest $MUSICMAN_KEEP_BUILDS builds (30). When current moves to another build, the
# musicman-notify daemon, which runs current, is restarted if it runs or failed, once a burst of publishes
# settles ($MUSICMAN_RESTART_DELAY seconds, 5; MUSICMAN_RESTART_DAEMON=0: never).
#
#   scripts/publish-local.sh [commit]
set -euo pipefail

repo="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
commit="$(git -C "$repo" rev-parse --short "${1:-HEAD}")"
root="${MUSICMAN_HOME:-$HOME/.local/share/musicman}"
builds="${MUSICMAN_BUILDS:-$root/builds}"
keep="${MUSICMAN_KEEP_BUILDS:-30}"
version="$(git -C "$repo" show "$commit:package.json" | node -e \
  'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).version))')"
id="$version-$commit"
target="$builds/$id"

if [[ -e "$target/BUILD.json" ]]; then
  echo "musicman build $id already exists"
else
  mkdir -p "$builds"
  staging="$(mktemp -d "$builds/.staging-$id-XXXXXX")"
  trap 'rm -rf "$staging"' EXIT
  git -C "$repo" archive "$commit" package.json pnpm-workspace.yaml pnpm-lock.yaml cli common |
    tar -x -C "$staging"
  # production dependencies only, from the local pnpm store when it has them
  (cd "$staging" && { pnpm install --frozen-lockfile --prod --offline --ignore-scripts >/dev/null 2>&1 ||
    pnpm install --frozen-lockfile --prod --ignore-scripts >/dev/null; })
  # a build that cannot start is not published
  node "$staging/cli/lib/cli.js" --version >/dev/null
  git -C "$repo" log -1 --format='%h%n%cI%n%s' "$commit" | node -e '
    const [commit, committedAt, ...subject] = require("fs").readFileSync(0, "utf8").trimEnd().split("\n");
    const build = { version: process.argv[1], commit, subject: subject.join("\n"), committedAt,
      builtAt: new Date().toISOString() };
    console.log(JSON.stringify(build, null, 2));' "$version" >"$staging/BUILD.json"
  mv "$staging" "$target"
  trap - EXIT
  echo "built musicman $id"
fi

# swap the current link atomically
previous="$(readlink -f "$root/current" 2>/dev/null || true)"
ln -sfn "$target" "$root/.current.tmp"
mv -T "$root/.current.tmp" "$root/current"
echo "current -> $target"

# the daemon keeps running the build it started with: restart it on the new one, when it runs (or failed;
# a daemon stopped by hand is left alone). Several commits in a row publish one build each within seconds,
# and a restart per build trips systemd's start limit, so after a pause only the build still current
# restarts it, after clearing a failed state.
daemon_state() { systemctl --user is-active musicman-notify.service 2>/dev/null || true; }
if [[ "${MUSICMAN_RESTART_DAEMON:-1}" != 0 && "$previous" != "$(readlink -f "$target")" ]] &&
  [[ "$(daemon_state)" =~ ^(active|activating|failed)$ ]]; then
  sleep "${MUSICMAN_RESTART_DELAY:-5}"
  if [[ "$(readlink -f "$root/current")" == "$(readlink -f "$target")" ]]; then
    systemctl --user reset-failed musicman-notify.service 2>/dev/null || true
    if systemctl --user restart musicman-notify.service 2>/dev/null; then
      echo "restarted musicman-notify on $id"
    else
      echo "could not restart musicman-notify, restart it by hand" >&2
    fi
  else
    echo "musicman-notify left to the newer build"
  fi
fi

# remove the oldest builds beyond $keep, never the current one
mapfile -t old < <(ls -1dt "$builds"/*/ 2>/dev/null | tail -n +"$((keep + 1))")
for dir in "${old[@]}"; do
  [[ "$(readlink -f "$dir")" == "$(readlink -f "$target")" ]] || rm -rf "$dir"
done
