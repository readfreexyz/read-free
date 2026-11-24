#!/bin/sh
# Releases for people who install Read Free with website/install.sh (docs/auto-update.md).
#
#   tools/release.sh keygen   make the release signing key, once. It asks for a passphrase; keep
#                             the key and the passphrase somewhere safe, with a backup: installed
#                             copies only take updates signed by it, so losing it means everyone
#                             reinstalling. Its public half goes into website/install.sh.
#   tools/release.sh build    dist/: the extension as read-free-<version>.zip, latest.txt (its
#                             version, file name, SHA-256, size and date), latest.txt.sig (the
#                             signature), and website/'s files, with the release and the site's
#                             address (the first of RELEASE_URLS) written into index.html. Upload
#                             all of dist/ to the site and each mirror (RELEASE_URLS). And for
#                             Firefox (docs/firefox.md): read-free-<version>.xpi, signed by
#                             Mozilla, which the extension's code is sent to, and updates.json.
#   tools/release.sh amo-key  keep Mozilla's API key in the macOS Keychain, once, for that.
#   tools/release.sh amo-check  see that Mozilla takes the key. Nothing is uploaded.
#   tools/release.sh amo-test   have Mozilla sign a tiny add-on that isn't Read Free, and check it.
#
# The zip is the committed extension/ (git archive of HEAD), not the working folder: commit and
# bump the manifest version first.
# READFREE_RELEASE_KEY: the key (default ~/.config/read-free/release-key). For tests:
# READFREE_REPO (the repository to release, default this one), READFREE_DIST (default dist/),
# READFREE_INSTALLER (the install script whose key is checked and shipped).
# READFREE_FIREFOX=no: a release for Chrome alone, the site without its Firefox parts.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
REPO=${READFREE_REPO:-$ROOT}
KEY=${READFREE_RELEASE_KEY:-"$HOME/.config/read-free/release-key"}
DIST=${READFREE_DIST:-"$ROOT/dist"}
INSTALLER=${READFREE_INSTALLER:-"$ROOT/website/install.sh"}
# The Windows installer holds the same key and addresses (as $SIGNER and $RELEASE_URLS)
PS_INSTALLER="$ROOT/website/install.ps1"
NAMESPACE=read-free-release
PRINCIPAL=read-free
AMO_SERVICE=read-free-amo # in the Keychain; the same as tools/firefox-release.mjs's KEYCHAIN

die() { echo "release: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 isn't installed"; }
sha256() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1"; else sha256sum "$1"; fi | cut -d' ' -f1; }
# The SIGNER line's value in the install script
signer() { sed -n "s/^SIGNER='\(.*\)'\$/\1/p" "$INSTALLER" | head -n 1; }

keygen() {
  need ssh-keygen
  [ -e "$KEY" ] && die "$KEY already exists"
  mkdir -p "$(dirname "$KEY")"
  chmod 700 "$(dirname "$KEY")"
  # The comment is published with the public key: the project's name, not user@host
  ssh-keygen -q -t ed25519 -C "$PRINCIPAL" -f "$KEY"
  set -- $(cat "$KEY.pub")
  line="$PRINCIPAL namespaces=\"$NAMESPACE\" $1 $2"
  sed "s|^SIGNER=.*\$|SIGNER='$line'|" "$INSTALLER" > "$INSTALLER.tmp" && mv "$INSTALLER.tmp" "$INSTALLER"
  [ "$(signer)" = "$line" ] || die "couldn't write the key into $INSTALLER"
  if [ -f "$PS_INSTALLER" ]; then
    sed "s|^\\\$SIGNER = .*\$|\$SIGNER = '$line'|" "$PS_INSTALLER" > "$PS_INSTALLER.tmp" && mv "$PS_INSTALLER.tmp" "$PS_INSTALLER"
    grep -qF "\$SIGNER = '$line'" "$PS_INSTALLER" || die "couldn't write the key into $PS_INSTALLER"
  fi
  echo "key: $KEY (private: keep it, and its passphrase, safe)"
  echo "public half: in $INSTALLER; commit it"
}

# Mozilla's API key (addons.mozilla.org, Developer Hub, Manage API Keys). `security` asks for each
# part itself, without showing it, so it's never in this script or on a command line. -T "": no
# program may read it without macOS asking first.
amo_key() {
  need security
  echo "Mozilla's API key, from https://addons.mozilla.org/developers/addon/api/key/"
  echo "Paste each part at its prompt, twice; nothing shows as you paste."
  echo
  echo "1. The JWT issuer"
  security add-generic-password -U -T "" -s "$AMO_SERVICE" -a issuer -l "Read Free: Mozilla API key (issuer)" -w || die "not kept"
  echo "2. The JWT secret"
  security add-generic-password -U -T "" -s "$AMO_SERVICE" -a secret -l "Read Free: Mozilla API key (secret)" -w || die "not kept"
  echo "Kept in your Keychain, as $AMO_SERVICE. tools/release.sh build uses it; macOS asks each time."
}

build() {
  need git; need ssh-keygen
  [ -f "$KEY" ] || die "no signing key at $KEY (tools/release.sh keygen)"
  line=$(signer)
  case "$line" in "$PRINCIPAL namespaces=\"$NAMESPACE\" ssh-ed25519 "*) ;; *) die "$INSTALLER has no signing key yet (tools/release.sh keygen)" ;; esac
  if [ -f "$KEY.pub" ]; then pub=$(cut -d' ' -f2 "$KEY.pub"); else pub=$(ssh-keygen -y -f "$KEY" | cut -d' ' -f2); fi
  [ "$pub" = "${line##* }" ] || die "$KEY isn't the key in $INSTALLER"
  # The site: the first release address. index.html shows it in a command people paste into a
  # shell, so only plain characters
  site=$(sed -n "s/^RELEASE_URLS='\(.*\)'\$/\1/p" "$INSTALLER" | head -n 1 | awk '{ print $1 }')
  [ -n "$site" ] || die "$INSTALLER has no release address yet (RELEASE_URLS)"
  printf '%s' "$site" | grep -Eqx 'https://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._~-]+)*/' \
    || die "the first release address isn't a plain https address ending in /: $site"
  if [ -n "$(git -C "$REPO" status --porcelain -- extension website)" ]; then
    echo "release: note: extension/ or website/ has uncommitted changes; they aren't in the release" >&2
  fi
  version=$(git -C "$REPO" show HEAD:extension/manifest.json | sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([0-9.]*\)".*/\1/p' | head -n 1)
  printf '%s' "$version" | grep -Eqx '[0-9]{1,5}(\.[0-9]{1,5}){0,3}' || die "no version in the committed manifest"
  zipname="read-free-$version.zip"

  mkdir -p "$DIST"
  # Firefox first: it can take Mozilla a while, or be refused, and dist/ is left as it was then
  FIREFOX=${READFREE_FIREFOX:-yes}
  xpiname=
  if [ "$FIREFOX" = no ]; then
    rm -f "$DIST"/read-free-*.xpi "$DIST/updates.json"
  else
    need node; need unzip
    xpiname=$(node "$ROOT/tools/firefox-release.mjs" "$REPO" "$site" "$DIST") || exit 1
    [ "$xpiname" = "read-free-$version.xpi" ] || die "the Firefox file is $xpiname, not version $version"
  fi
  rm -f "$DIST"/read-free-*.zip "$DIST/latest.txt" "$DIST/latest.txt.sig"
  # In UTC: a zip keeps local time beside UTC, which would tell the maintainer's time zone
  TZ=UTC git -C "$REPO" archive --format=zip -o "$DIST/$zipname" HEAD:extension
  size=$(wc -c < "$DIST/$zipname" | tr -d ' ')
  sum=$(sha256 "$DIST/$zipname")
  stamp=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  {
    echo "read-free-release 1"
    echo "version=$version"
    echo "zip=$zipname"
    echo "sha256=$sum"
    echo "size=$size"
    echo "date=$stamp"
  } > "$DIST/latest.txt"
  ssh-keygen -q -Y sign -f "$KEY" -n "$NAMESPACE" "$DIST/latest.txt"
  # The site's own files, and the installer, next to the release. The front page gets the
  # release and the site's address written in.
  for f in $(git -C "$REPO" ls-tree --name-only HEAD website/); do
    name=$(basename "$f")
    case "$name" in
      install.sh) ;;
      # The Windows installer, with the same key and addresses as install.sh
      install.ps1)
        urls=$(sed -n "s/^RELEASE_URLS='\(.*\)'\$/\1/p" "$INSTALLER" | head -n 1)
        git -C "$REPO" show "HEAD:$f" | sed \
          -e "s|^\\\$SIGNER = .*\$|\$SIGNER = '$line'|" -e "s|^\\\$RELEASE_URLS = .*\$|\$RELEASE_URLS = '$urls'|" > "$DIST/$name"
        grep -qxF "\$SIGNER = '$line'" "$DIST/$name" && grep -qxF "\$RELEASE_URLS = '$urls'" "$DIST/$name" \
          || die "couldn't write the key and addresses into install.ps1" ;;
      index.html)
        # <!-- firefox --> … <!-- /firefox -->: the page's Firefox parts, left out of a release
        # without one, and <!-- chrome-only --> … <!-- /chrome-only --> out of one with
        if [ -n "$xpiname" ]; then without=chrome-only; else without=firefox; fi
        git -C "$REPO" show "HEAD:$f" | sed -e "/<!-- $without -->/,/<!-- \\/$without -->/d" \
          -e '/^ *<!-- \/*firefox -->$/d' -e '/^ *<!-- \/*chrome-only -->$/d' -e "s|{{xpi}}|$xpiname|g" \
          -e "s|{{version}}|$version|g" -e "s|{{zip}}|$zipname|g" -e "s|{{size}}|$(( (size + 1023) / 1024 )) KB|g" \
          -e "s|{{sha256}}|$sum|g" -e "s|{{date}}|${stamp%%T*}|g" -e "s|{{site}}|$site|g" > "$DIST/$name"
        if grep -Eq '\{\{[a-z0-9]+\}\}' "$DIST/$name"; then die "index.html has a field release.sh doesn't fill"; fi ;;
      *) git -C "$REPO" show "HEAD:$f" > "$DIST/$name" ;;
    esac
  done
  cp "$INSTALLER" "$DIST/install.sh"

  # As an installed copy will check it
  printf '%s\n' "$line" > "$DIST/.allowed_signers"
  ssh-keygen -Y verify -f "$DIST/.allowed_signers" -I "$PRINCIPAL" -n "$NAMESPACE" -s "$DIST/latest.txt.sig" < "$DIST/latest.txt" > /dev/null \
    || die "the signature doesn't verify"
  rm -f "$DIST/.allowed_signers"
  echo "Read Free $version: $DIST"
  ls -1 "$DIST" | sed 's/^/  /'
  echo "Upload these to the site and each mirror."
}

case "${1:-}" in
  keygen) keygen ;;
  build) build ;;
  amo-key) amo_key ;;
  amo-check) need node; exec node "$ROOT/tools/firefox-release.mjs" check ;;
  amo-test) need node; need unzip; exec node "$ROOT/tools/firefox-release.mjs" test "$ROOT/build/signing-test.xpi" ;;
  *) echo "usage: $0 keygen | build | amo-key | amo-check | amo-test" >&2; exit 2 ;;
esac
