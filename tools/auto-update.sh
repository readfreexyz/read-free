#!/bin/sh
# The release copy of Read Free and the LaunchAgent that keeps it up to date (docs/auto-update.md).
#
#   tools/auto-update.sh install     clone the repository (if it isn't there yet), write and load
#                                    the LaunchAgent, and pull once now
#   tools/auto-update.sh status      where everything is, the versions, the last log lines
#   tools/auto-update.sh uninstall   unload and delete the LaunchAgent (the clone stays)
#
# The release copy: a clone of GitHub's main, by default in
# ~/Library/Application Support/NYT Fixer (NYTFIX_RELEASE to change it). Chrome loads its
# extension/ folder unpacked; nobody works in it.
# The LaunchAgent (local.nytfixer.update): at login and every hour, `git pull --ff-only` in the
# clone, with your git's own GitHub login (the keychain). Its command is written into the plist
# here, so nothing from the repository runs outside Chrome. It logs failures, and each update, to
# ~/Library/Logs/NYT Fixer/update.log.
# The extension notices the newer version on disk and reloads itself (extension/src/update.js).
set -eu

# The folder, the label and the log keep the project's first name (NYT Fixer): Chrome knows an
# unpacked extension by its folder, so a new one would install it as a new extension, with
# default settings and an empty tally.
LABEL=${NYTFIX_LABEL:-local.nytfixer.update}
DEST=${NYTFIX_RELEASE:-"$HOME/Library/Application Support/NYT Fixer"}
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGDIR="$HOME/Library/Logs/NYT Fixer"
LOG="$LOGDIR/update.log"
INTERVAL=3600
HERE=$(cd "$(dirname "$0")/.." && pwd)
DOMAIN="gui/$(id -u)"

die() { echo "auto-update: $*" >&2; exit 1; }
xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

# The job: pull, and log a failure or an update. $1 git, $2 the clone, $3 the log.
JOB='before=$("$1" -C "$2" rev-parse HEAD 2>/dev/null)
if ! out=$("$1" -C "$2" pull --ff-only --no-rebase --quiet 2>&1); then
  printf "%s pull failed:\n%s\n" "$(date "+%Y-%m-%d %H:%M:%S")" "$out" >> "$3"
  exit 1
fi
after=$("$1" -C "$2" rev-parse HEAD)
[ "$before" = "$after" ] || printf "%s updated: %s\n" "$(date "+%Y-%m-%d %H:%M:%S")" "$("$1" -C "$2" log -1 --format="%h %s")" >> "$3"'

install() {
  GIT=$(command -v git) || die "git isn't installed"
  REMOTE=$(git -C "$HERE" remote get-url origin) || die "no origin remote in $HERE"
  if [ -d "$DEST/.git" ]; then
    [ "$(git -C "$DEST" remote get-url origin)" = "$REMOTE" ] || die "$DEST is a clone of something else"
    echo "release copy: $DEST (already there)"
  else
    [ -e "$DEST" ] && die "$DEST exists and isn't a clone"
    mkdir -p "$(dirname "$DEST")"
    GIT_TERMINAL_PROMPT=0 git clone --quiet --branch main "$REMOTE" "$DEST" || die "couldn't clone $REMOTE"
    echo "release copy: cloned into $DEST"
  fi
  mkdir -p "$LOGDIR" "$(dirname "$PLIST")"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>$(xml "$JOB")</string>
    <string>nytfix-update</string>
    <string>$(xml "$GIT")</string>
    <string>$(xml "$DEST")</string>
    <string>$(xml "$LOG")</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>GIT_TERMINAL_PROMPT</key>
    <string>0</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>$INTERVAL</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>$(xml "$LOG")</string>
  <key>StandardErrorPath</key>
  <string>$(xml "$LOG")</string>
</dict>
</plist>
EOF
  plutil -lint -s "$PLIST" || die "the plist didn't come out right: $PLIST"
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  launchctl bootstrap "$DOMAIN" "$PLIST" || die "launchctl couldn't load $PLIST"
  echo "LaunchAgent: $PLIST (loaded; it pulls now, at login and every hour)"
  echo "log: $LOG"
  echo
  echo "In Chrome: chrome://extensions > Developer mode > Load unpacked > $DEST/extension"
}

status() {
  echo "release copy: $DEST"
  if [ -d "$DEST/.git" ]; then
    echo "  at: $(git -C "$DEST" log -1 --format='%h %s (%cr)')"
    echo "  version on disk: $(sed -n 's/^ *"version": "\(.*\)",$/\1/p' "$DEST/extension/manifest.json")"
  else
    echo "  (not there)"
  fi
  echo "LaunchAgent: $PLIST"
  if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
    launchctl print "$DOMAIN/$LABEL" | grep -E '^[[:space:]]+(state|runs|last exit code) =' | awk '!seen[$1]++' | sed 's/^[[:space:]]*/  /'
  else
    echo "  (not loaded)"
  fi
  echo "log: $LOG"
  [ -f "$LOG" ] && tail -n 5 "$LOG" | sed 's/^/  /' || true
}

uninstall() {
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "LaunchAgent removed. The release copy is still in $DEST; delete it once Chrome no longer loads it."
}

case "${1:-}" in
  install) install ;;
  status) status ;;
  uninstall) uninstall ;;
  *) echo "usage: $0 install | status | uninstall" >&2; exit 2 ;;
esac
