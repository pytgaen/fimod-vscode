#!/usr/bin/env bash
# Bump package.json to X.Y.Z-rc.N, commit chore(prerelease), and tag vX.Y.Z-rc.N.
# Does not push — push is always explicit and user-confirmed.
#
# Usage: scripts/prerelease-github.sh X.Y.Z N

set -euo pipefail

VERSION="${1:-}"
RC="${2:-}"

if [[ -z "$VERSION" || -z "$RC" ]]; then
  echo "Usage: $0 X.Y.Z N" >&2
  exit 1
fi

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Invalid version: $VERSION (expected X.Y.Z)" >&2
  exit 1
fi

if ! [[ "$RC" =~ ^[0-9]+$ ]]; then
  echo "Invalid rc: $RC (expected positive integer)" >&2
  exit 1
fi

FULL="${VERSION}-rc.${RC}"
TAG="v${FULL}"

if [[ -n "$(git status --short)" ]]; then
  echo "Working tree dirty — commit or stash first." >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
  echo "Tag ${TAG} already exists. Try rc.$((RC + 1))." >&2
  exit 1
fi

echo "Bumping package.json → ${FULL}"
npm version "${FULL}" --no-git-tag-version --allow-same-version >/dev/null

echo "Committing"
git add package.json package-lock.json
git commit -m "chore(prerelease): ${FULL}"

echo "Tagging ${TAG}"
git tag "${TAG}"

cat <<EOF

Done.
  Commit: $(git log -1 --format='%h %s')
  Tag:    ${TAG}

Push with:
  git push && git push origin ${TAG}
EOF
