#!/usr/bin/env bash
#
# Update the AV Ranch app in place on the server.
#
#   ./scripts/update.sh            pull, rebuild if anything changed, restart
#   ./scripts/update.sh --force    rebuild and restart even with no new commits
#   ./scripts/update.sh --check    report what would happen, change nothing
#
# Safe to run when there is nothing to do: with no new commits and no --force
# it backs out before touching the build or the service.
#
set -euo pipefail

APP_DIR="${RANCH_APP_DIR:-/mnt/data/ranch}"
SERVICE="${RANCH_SERVICE:-ranch}"
BACKUP_CMD="${RANCH_BACKUP_CMD:-/usr/local/bin/ranch-backup}"
HEALTH_URL="${RANCH_HEALTH_URL:-http://localhost:4848/}"

FORCE=0
CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --check) CHECK_ONLY=1 ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

log()  { printf '\033[36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m  ok\033[0m %s\n' "$*"; }
warn() { printf '\033[33m  !!\033[0m %s\n' "$*"; }
die()  { printf '\033[31m  xx\033[0m %s\n' "$*" >&2; exit 1; }

cd "$APP_DIR" || die "app directory not found: $APP_DIR"
[ -d .git ] || die "$APP_DIR is not a git checkout"

# --- what is there to do? ------------------------------------------------
log "Checking for updates in $APP_DIR"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git fetch --quiet origin "$BRANCH"
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL" = "$REMOTE" ]; then
  ok "already up to date ($BRANCH @ ${LOCAL:0:7})"
  if [ "$FORCE" -eq 0 ]; then
    log "Nothing to do. Use --force to rebuild anyway."
    # Still confirm the service is actually healthy before we go.
    if systemctl is-active --quiet "$SERVICE"; then
      ok "$SERVICE is running"
    else
      die "$SERVICE is NOT running — start it with: sudo systemctl start $SERVICE"
    fi
    exit 0
  fi
  warn "no new commits, but --force given"
else
  BEHIND=$(git rev-list --count "$LOCAL..$REMOTE")
  ok "$BEHIND new commit(s) on origin/$BRANCH"
  git --no-pager log --oneline "$LOCAL..$REMOTE" | sed 's/^/     /'
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
  log "--check given, stopping before any changes."
  exit 0
fi

# --- back up the database before we change anything ----------------------
if [ -x "$BACKUP_CMD" ]; then
  log "Backing up the database first"
  "$BACKUP_CMD" | sed 's/^/     /'
else
  warn "no backup command at $BACKUP_CMD — continuing without a fresh backup"
fi

ROLLBACK_TO="$LOCAL"

# --- pull, install, build ------------------------------------------------
log "Pulling $BRANCH"
git merge --ff-only "origin/$BRANCH" 2>/dev/null || die "fast-forward failed — the checkout has local commits or changes"
ok "now at $(git rev-parse --short HEAD)"

if ! git diff --quiet "$ROLLBACK_TO" HEAD -- package-lock.json package.json; then
  log "Dependencies changed — running npm ci"
  npm ci --no-audit --no-fund 2>&1 | tail -3 | sed 's/^/     /'
else
  ok "dependencies unchanged, skipping npm ci"
fi

log "Building the PWA"
npm run build 2>&1 | tail -6 | sed 's/^/     /'
[ -f dist/index.html ] || die "build produced no dist/index.html"
[ -f dist/sw.js ] || warn "build produced no dist/sw.js — the service worker is missing"

# --- restart and verify --------------------------------------------------
log "Restarting $SERVICE"
sudo systemctl restart "$SERVICE"

for i in $(seq 1 15); do
  sleep 1
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" || true)
  [ "$CODE" = "200" ] && break
done

if [ "${CODE:-000}" != "200" ]; then
  warn "app did not answer 200 (got ${CODE:-no response}) — rolling back to ${ROLLBACK_TO:0:7}"
  git reset --hard "$ROLLBACK_TO" >/dev/null
  npm ci --no-audit --no-fund >/dev/null 2>&1 || true
  npm run build >/dev/null 2>&1 || true
  sudo systemctl restart "$SERVICE"
  die "update failed and was rolled back — check: sudo journalctl -u $SERVICE -n 50"
fi

ok "app responding 200 at $HEALTH_URL"
ok "updated to $(git --no-pager log --oneline -1)"
log "Done."
