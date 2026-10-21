#!/usr/bin/env bash
# Builds the committed state of the repo (HEAD, never uncommitted edits) into
# $MUSICMAN_BUILDS/<version>-<commit> and points $MUSICMAN_BUILDS/../current at it, so the musicman
# alias can run a stable build while the repo is being changed. Run by the post-commit hook after every
# commit; keeps the newest $MUSICMAN_KEEP_BUILDS builds (30).
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
ln -sfn "$target" "$root/.current.tmp"
mv -T "$root/.current.tmp" "$root/current"
echo "current -> $target"

# remove the oldest builds beyond $keep, never the current one
mapfile -t old < <(ls -1dt "$builds"/*/ 2>/dev/null | tail -n +"$((keep + 1))")
for dir in "${old[@]}"; do
  [[ "$(readlink -f "$dir")" == "$(readlink -f "$target")" ]] || rm -rf "$dir"
done
