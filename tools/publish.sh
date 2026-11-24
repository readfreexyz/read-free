#!/bin/sh
# Publishes the release that tools/release.sh build put in dist/ to the site and its mirror
# (docs/auto-update.md).
#
#   tools/publish.sh [all | mirror | site]     all by default
#
# First it checks dist/ as an installed copy would: latest.txt's signature against the key in
# dist/install.sh (install.ps1 with the same key and addresses), the zip's name, size and SHA-256,
# index.html's fields all filled, _headers
# there; and for Firefox, the signed file and updates.json in step with it, or neither of them. It won't publish a version older than the one the site has. Then:
#   mirror  the GitHub Pages repository: a clone of it (READFREE_MIRROR_REPO) with a git identity
#           of its own, never the global one. Its files become dist/'s; committed in UTC, pushed.
#   site    the Cloudflare Worker that serves the site (READFREE_WORKER), deployed from dist/ with
#           Wrangler, run in a temporary folder: Wrangler with no configuration "sets up" the
#           folder it's run in, rewriting package.json and .gitignore.
# Then it waits until every address in RELEASE_URLS serves this latest.txt, with the
# Access-Control-Allow-Origin header the extension needs.
#
# Cloudflare: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID if set, otherwise the cf CLI's sign-in
# (cf auth login). READFREE_DIST, READFREE_WRANGLER (the Wrangler package to run) and
# READFREE_VERIFY=0 (no waiting; for tests) are for tests and odd setups.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIST=${READFREE_DIST:-"$ROOT/dist"}
MIRROR=${READFREE_MIRROR_REPO:-"$HOME/projects/read-free-site"}
WORKER=${READFREE_WORKER:-readfree}
WRANGLER=${READFREE_WRANGLER:-wrangler@4.164.0}
COMPATIBILITY_DATE=2026-11-17
NAMESPACE=read-free-release
PRINCIPAL=read-free
WHAT=${1:-all}

die() { echo "publish: $*" >&2; exit 1; }
say() { echo "publish: $*"; }
sha256() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1"; else sha256sum "$1"; fi | cut -d' ' -f1; }
# $1 newer than $2, numerically: 0.14.10 is newer than 0.14.9
newer() {
  awk -v a="$1" -v b="$2" 'BEGIN { n = split(a, x, "."); m = split(b, y, "."); k = n > m ? n : m
    for (i = 1; i <= k; i++) { p = x[i] + 0; q = y[i] + 0; if (p > q) exit 0; if (p < q) exit 1 }
    exit 1 }'
}
field() { sed -n "s/^$1=//p" "$DIST/latest.txt" | head -n 1; }
setting() { sed -n "s/^$1='\(.*\)'\$/\1/p" "$DIST/install.sh" | head -n 1; }

case "$WHAT" in all | mirror | site) ;; *) echo "usage: $0 [all | mirror | site]" >&2; exit 2 ;; esac
printf '%s' "$WORKER" | grep -Eqx '[a-z0-9-]{1,63}' || die "READFREE_WORKER isn't a Worker name"
for cmd in git ssh-keygen curl; do command -v "$cmd" >/dev/null 2>&1 || die "$cmd isn't installed"; done

TMP=$(mktemp -d "${TMPDIR:-/tmp}/readfree-publish.XXXXXX")
trap 'rm -rf "$TMP"' EXIT INT TERM

# The release, checked
[ -f "$DIST/latest.txt" ] && [ -f "$DIST/latest.txt.sig" ] && [ -f "$DIST/install.sh" ] \
  || die "no release in $DIST (tools/release.sh build)"
SIGNER=$(setting SIGNER)
URLS=$(setting RELEASE_URLS)
[ -n "$SIGNER" ] && [ -n "$URLS" ] || die "$DIST/install.sh has no signing key or no addresses"
# The Windows installer: the same key and addresses (tools/release.sh writes them in)
[ -f "$DIST/install.ps1" ] || die "no install.ps1 in $DIST"
grep -qxF "\$SIGNER = '$SIGNER'" "$DIST/install.ps1" && grep -qxF "\$RELEASE_URLS = '$URLS'" "$DIST/install.ps1" \
  || die "$DIST/install.ps1 doesn't have install.sh's key and addresses"
printf '%s\n' "$SIGNER" > "$TMP/allowed_signers"
ssh-keygen -Y verify -f "$TMP/allowed_signers" -I "$PRINCIPAL" -n "$NAMESPACE" -s "$DIST/latest.txt.sig" \
  < "$DIST/latest.txt" > /dev/null 2>&1 || die "latest.txt's signature doesn't check out"
VERSION=$(field version)
ZIP=$(field zip)
[ "$ZIP" = "read-free-$VERSION.zip" ] && [ -f "$DIST/$ZIP" ] || die "no $ZIP in $DIST"
[ "$(sha256 "$DIST/$ZIP")" = "$(field sha256)" ] && [ "$(wc -c < "$DIST/$ZIP" | tr -d ' ')" = "$(field size)" ] \
  || die "$ZIP isn't the file latest.txt describes"
[ -f "$DIST/index.html" ] || die "no index.html in $DIST"
if grep -Eq '\{\{[a-z0-9]+\}\}' "$DIST/index.html"; then die "index.html has fields left unfilled"; fi
[ -f "$DIST/_headers" ] || die "no _headers in $DIST: the site wouldn't send Access-Control-Allow-Origin"

# Firefox: the file Mozilla signed, what updates.json says of it, and the page's link to it; or
# none of the three (a release for Chrome alone)
SITE=${URLS%% *}
XPI="read-free-$VERSION.xpi"
for f in "$DIST"/*.xpi; do if [ -f "$f" ] && [ "$f" != "$DIST/$XPI" ]; then die "$(basename "$f") in $DIST isn't this release's"; fi; done
if [ -f "$DIST/$XPI" ]; then
  [ -f "$DIST/updates.json" ] || die "no updates.json in $DIST: Firefox would never update"
  unzip -Z1 "$DIST/$XPI" 2>/dev/null | grep -qxF META-INF/mozilla.rsa || die "$XPI isn't signed by Mozilla"
  grep -qF "\"version\": \"$VERSION\"" "$DIST/updates.json" && grep -qF "\"update_link\": \"$SITE$XPI\"" "$DIST/updates.json" \
    && grep -qF "\"update_hash\": \"sha256:$(sha256 "$DIST/$XPI")\"" "$DIST/updates.json" || die "updates.json doesn't describe $XPI"
  grep -qF "href=\"$XPI\"" "$DIST/index.html" || die "index.html doesn't link to $XPI"
else
  [ ! -f "$DIST/updates.json" ] || die "updates.json in $DIST, without $XPI"
  if grep -q '\.xpi' "$DIST/index.html"; then die "index.html links to a Firefox file that isn't in $DIST"; fi
fi

# What gets published: dist/'s files, without hidden ones (.DS_Store and the like)
STAGE="$TMP/release"
mkdir "$STAGE"
for f in "$DIST"/*; do if [ -f "$f" ]; then cp "$f" "$STAGE/"; fi; done

# Never back: an older version than the site's (the same one again is fine)
if [ "${READFREE_VERIFY:-1}" != 0 ] && curl -fsS --proto '=https' --max-time 20 -o "$TMP/live.txt" "${SITE}latest.txt" 2>/dev/null; then
  live=$(sed -n 's/^version=//p' "$TMP/live.txt" | head -n 1)
  if [ -n "$live" ] && newer "$live" "$VERSION"; then die "$SITE has $live, newer than $VERSION"; fi
fi

publish_mirror() {
  [ -d "$MIRROR/.git" ] || die "$MIRROR isn't a clone of the mirror's repository (READFREE_MIRROR_REPO)"
  [ "$(cd "$MIRROR" && pwd)" != "$ROOT" ] || die "READFREE_MIRROR_REPO is this repository"
  origin=$(git -C "$MIRROR" remote get-url origin 2>/dev/null) || die "$MIRROR has no origin"
  case "$origin" in *.github.io | *.github.io.git | *.github.io/) ;; *) die "$MIRROR isn't a GitHub Pages repository ($origin)" ;; esac
  # Its own identity: the global one is the maintainer's
  git -C "$MIRROR" config --local user.name > /dev/null && git -C "$MIRROR" config --local user.email > /dev/null \
    || die "$MIRROR has no git identity of its own: set user.name and user.email there"
  [ -z "$(git -C "$MIRROR" status --porcelain)" ] || die "$MIRROR has uncommitted changes"
  git -C "$MIRROR" pull --quiet --ff-only || die "couldn't update $MIRROR"
  # Its files become the release's; .nojekyll (serve the files as they are) and git's stay
  find "$MIRROR" -mindepth 1 -maxdepth 1 ! -name .git ! -name .nojekyll -exec rm -rf {} +
  cp "$STAGE"/* "$MIRROR/"
  [ -f "$MIRROR/.nojekyll" ] || : > "$MIRROR/.nojekyll"
  git -C "$MIRROR" add -A
  if git -C "$MIRROR" diff --cached --quiet; then
    say "mirror: already has Read Free $VERSION"
  else
    # In UTC: a commit keeps the local time zone
    TZ=UTC git -C "$MIRROR" commit --quiet -m "Read Free $VERSION"
    say "mirror: committed Read Free $VERSION"
  fi
  git -C "$MIRROR" push --quiet origin HEAD || die "couldn't push $MIRROR"
  say "mirror: pushed"
}

publish_site() {
  token=${CLOUDFLARE_API_TOKEN:-}
  account=${CLOUDFLARE_ACCOUNT_ID:-}
  if [ -z "$token" ] || [ -z "$account" ]; then
    command -v cf > /dev/null 2>&1 || die "set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, or sign in with the cf CLI (cf auth login)"
    command -v node > /dev/null 2>&1 || die "node isn't installed"
    # cf's sign-in (whoami refreshes it): its token, from the file whoami names, and its account
    cf auth whoami > "$TMP/whoami.json" 2> /dev/null || die "cf isn't signed in (cf auth login)"
    node -e '
      const fs = require("fs");
      const who = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const file = String(who.authSource || "").replace(/^.*? from /, "");
      const token = file && JSON.parse(fs.readFileSync(file, "utf8")).oauth_token;
      const accounts = who.accounts || [];
      if (!token) process.exit(1);
      if (accounts.length !== 1) process.exit(2);
      console.log(accounts[0].id);
      console.log(token);
    ' "$TMP/whoami.json" > "$TMP/cf" 2> /dev/null || case $? in
      2) die "cf can reach more than one Cloudflare account: set CLOUDFLARE_ACCOUNT_ID" ;;
      *) die "couldn't read cf's sign-in" ;;
    esac
    [ -n "$account" ] || account=$(sed -n 1p "$TMP/cf")
    [ -n "$token" ] || token=$(sed -n 2p "$TMP/cf")
  fi
  mkdir "$TMP/wrangler"
  printf '{\n  "name": "%s",\n  "compatibility_date": "%s",\n  "assets": { "directory": "%s" }\n}\n' \
    "$WORKER" "$COMPATIBILITY_DATE" "$STAGE" > "$TMP/wrangler/wrangler.json"
  if ! (cd "$TMP/wrangler" && CLOUDFLARE_API_TOKEN="$token" CLOUDFLARE_ACCOUNT_ID="$account" WRANGLER_SEND_METRICS=false \
    npx --yes "$WRANGLER" deploy --config "$TMP/wrangler/wrangler.json") > "$TMP/wrangler.log" 2>&1; then
    cat "$TMP/wrangler.log" >&2
    die "Wrangler couldn't deploy the site"
  fi
  say "site: deployed to the Worker $WORKER"
}

# The address serves the Firefox file as one: with another type, Firefox downloads it instead of
# offering to install it
serves_xpi() {
  [ -f "$DIST/$XPI" ] || return 0
  curl -fsS --proto '=https' --max-time 60 -D "$TMP/xpi-headers" -o "$TMP/served.xpi" "$1$XPI?v=$(date +%s)" 2> /dev/null \
    && cmp -s "$TMP/served.xpi" "$DIST/$XPI" && grep -iq '^content-type: application/x-xpinstall' "$TMP/xpi-headers"
}

# Every address serves this release, with the header; up to 5 minutes (GitHub Pages takes one
# or two)
verify() {
  [ "${READFREE_VERIFY:-1}" != 0 ] || return 0
  left=$URLS
  tries=0
  while [ -n "$left" ] && [ $tries -lt 30 ]; do
    [ $tries -eq 0 ] || sleep 10
    tries=$((tries + 1))
    still=
    for url in $left; do
      if curl -fsS --proto '=https' --max-time 20 -D "$TMP/headers" -o "$TMP/served.txt" "${url}latest.txt?v=$(date +%s)" 2> /dev/null \
        && cmp -s "$TMP/served.txt" "$DIST/latest.txt" \
        && grep -iq '^access-control-allow-origin: \*' "$TMP/headers" && serves_xpi "$url"; then
        say "$url serves Read Free $VERSION"
      else
        still="$still $url"
      fi
    done
    left=${still# }
  done
  [ -z "$left" ] && return 0
  for url in $left; do echo "publish: $url doesn't serve Read Free $VERSION (with Access-Control-Allow-Origin) yet" >&2; done
  [ "$WHAT" != all ] || exit 1
}

say "Read Free $VERSION, checked"
case "$WHAT" in
  all) publish_mirror; publish_site ;;
  mirror) publish_mirror ;;
  site) publish_site ;;
esac
verify
