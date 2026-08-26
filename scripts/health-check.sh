#!/usr/bin/env bash
#
# Collect a health snapshot of the AV Ranch server as JSON.
#
#   ./scripts/health-check.sh              print JSON to stdout
#   ./scripts/health-check.sh -o FILE      write atomically to FILE
#
# Run on the Pi itself. A systemd timer writes this to the file Caddy serves
# at /_health, so an off-site monitor can read it without SSH access.
#
# Every probe is wrapped so that one failing sensor degrades a single field to
# null rather than killing the whole report.
#
set -uo pipefail

APP_DIR="${RANCH_APP_DIR:-/mnt/data/ranch}"
DB="${RANCH_DB:-/mnt/data/ranch/data/ranch.db}"
BACKUP_DIR="${RANCH_BACKUP_DIR:-/mnt/data/backups}"
DATA_MOUNT="${RANCH_DATA_MOUNT:-/mnt/data}"
DISK_DEV="${RANCH_DISK_DEV:-/dev/sda}"
APP_URL="${RANCH_APP_URL:-http://localhost:4848/}"
PUBLIC_HOST="${RANCH_PUBLIC_HOST:-ranch-booking.duckdns.org}"

OUT=""
while getopts "o:" opt; do
  case "$opt" in
    o) OUT="$OPTARG" ;;
    *) echo "usage: $0 [-o FILE]" >&2; exit 2 ;;
  esac
done

# Emit a JSON string, or the bare word null when empty.
jstr() { [ -z "${1:-}" ] && printf 'null' || printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"; }
jnum() { [ -z "${1:-}" ] && printf 'null' || printf '%s' "$1"; }
jbool() { [ "${1:-}" = "true" ] && printf 'true' || printf 'false'; }

# --- services ------------------------------------------------------------
svc_state() { systemctl is-active "$1" 2>/dev/null || echo unknown; }
RANCH_STATE=$(svc_state ranch)
CADDY_STATE=$(svc_state caddy)

# --- app responds? -------------------------------------------------------
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$APP_URL" 2>/dev/null)
HTTP_MS=$(curl -s -o /dev/null -w '%{time_total}' --max-time 8 "$APP_URL" 2>/dev/null | awk '{printf "%d", $1*1000}')
API_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "${APP_URL%/}/api/rooms" 2>/dev/null)

# --- disks ---------------------------------------------------------------
root_pct=$(df --output=pcent / 2>/dev/null | tail -1 | tr -dc '0-9')
root_avail=$(df -BG --output=avail / 2>/dev/null | tail -1 | tr -dc '0-9')
data_pct=$(df --output=pcent "$DATA_MOUNT" 2>/dev/null | tail -1 | tr -dc '0-9')
data_avail=$(df -BG --output=avail "$DATA_MOUNT" 2>/dev/null | tail -1 | tr -dc '0-9')
data_mounted=false; mountpoint -q "$DATA_MOUNT" 2>/dev/null && data_mounted=true

# --- host ----------------------------------------------------------------
UPTIME_S=$(cut -d. -f1 /proc/uptime 2>/dev/null)
LOAD1=$(awk '{print $1}' /proc/loadavg 2>/dev/null)
MEM_AVAIL_MB=$(awk '/MemAvailable/{printf "%d", $2/1024}' /proc/meminfo 2>/dev/null)
CPU_TEMP=$(awk '{printf "%.1f", $1/1000}' /sys/class/thermal/thermal_zone0/temp 2>/dev/null)
THROTTLED=$(vcgencmd get_throttled 2>/dev/null | cut -d= -f2)

# --- drive SMART ---------------------------------------------------------
# smartctl lives in /usr/sbin, which is not on a non-interactive ssh PATH,
# so resolve it explicitly rather than trusting `command -v`.
SMARTCTL=""
for c in /usr/sbin/smartctl /sbin/smartctl "$(command -v smartctl 2>/dev/null)"; do
  [ -x "$c" ] && { SMARTCTL="$c"; break; }
done

SMART_OK=""; SMART_REALLOC=""; SMART_PENDING=""; SMART_TEMP=""; SMART_HOURS=""
if [ -n "$SMARTCTL" ]; then
  SMART_RAW=$(sudo -n "$SMARTCTL" -d sat -H -A "$DISK_DEV" 2>/dev/null)
  if [ -n "$SMART_RAW" ]; then
    echo "$SMART_RAW" | grep -q "PASSED" && SMART_OK="PASSED" || SMART_OK="CHECK"
    SMART_REALLOC=$(echo "$SMART_RAW" | awk '/Reallocated_Sector_Ct/{print $10}')
    SMART_PENDING=$(echo "$SMART_RAW" | awk '/Current_Pending_Sector/{print $10}')
    SMART_TEMP=$(echo "$SMART_RAW" | awk '/Temperature_Celsius/{print $10}')
    SMART_HOURS=$(echo "$SMART_RAW" | awk '/Power_On_Hours/{print $10}')
  fi
fi

# --- database + backups --------------------------------------------------
DB_BYTES=$(stat -c%s "$DB" 2>/dev/null)
DB_OK=false
if [ -r "$DB" ] && command -v sqlite3 >/dev/null 2>&1; then
  [ "$(sqlite3 "$DB" 'PRAGMA quick_check;' 2>/dev/null)" = "ok" ] && DB_OK=true
fi
BOOKINGS=$(sqlite3 "$DB" 'SELECT COUNT(*) FROM bookings;' 2>/dev/null)
PENDING=$(sqlite3 "$DB" "SELECT COUNT(*) FROM bookings WHERE status='pending';" 2>/dev/null)

NEWEST_BACKUP=$(ls -t "$BACKUP_DIR"/ranch-*.db.gz 2>/dev/null | head -1)
BACKUP_AGE_H=""
[ -n "$NEWEST_BACKUP" ] && BACKUP_AGE_H=$(( ( $(date +%s) - $(stat -c%Y "$NEWEST_BACKUP") ) / 3600 ))
BACKUP_COUNT=$(ls "$BACKUP_DIR"/ranch-*.db.gz 2>/dev/null | wc -l | tr -d ' ')

# --- TLS certificate -----------------------------------------------------
CERT_DAYS=""
CERT_END=$(echo | openssl s_client -connect "${PUBLIC_HOST}:443" -servername "$PUBLIC_HOST" 2>/dev/null \
  | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
if [ -n "$CERT_END" ]; then
  CERT_EPOCH=$(date -d "$CERT_END" +%s 2>/dev/null)
  [ -n "$CERT_EPOCH" ] && CERT_DAYS=$(( (CERT_EPOCH - $(date +%s)) / 86400 ))
fi

# --- overall verdict -----------------------------------------------------
PROBLEMS=()
[ "$RANCH_STATE" != "active" ]      && PROBLEMS+=("ranch service is $RANCH_STATE")
[ "$CADDY_STATE" != "active" ]      && PROBLEMS+=("caddy service is $CADDY_STATE")
[ "${HTTP_CODE:-000}" != "200" ]    && PROBLEMS+=("app returned ${HTTP_CODE:-no response}")
# 401 is the healthy answer from /api/rooms when not signed in; 5xx is not.
case "${API_CODE:-000}" in 200|401) ;; *) PROBLEMS+=("api returned ${API_CODE:-no response}") ;; esac
[ "$data_mounted" != "true" ]       && PROBLEMS+=("$DATA_MOUNT is not mounted")
[ -n "$root_pct" ] && [ "$root_pct" -ge 90 ] && PROBLEMS+=("root disk ${root_pct}% full")
[ -n "$data_pct" ] && [ "$data_pct" -ge 90 ] && PROBLEMS+=("data disk ${data_pct}% full")
[ "$DB_OK" != "true" ]              && PROBLEMS+=("database failed quick_check")
[ -n "$BACKUP_AGE_H" ] && [ "$BACKUP_AGE_H" -gt 48 ] && PROBLEMS+=("newest backup is ${BACKUP_AGE_H}h old")
[ -z "$NEWEST_BACKUP" ]             && PROBLEMS+=("no backups found")
[ -n "$SMART_PENDING" ] && [ "$SMART_PENDING" -gt 0 ] && PROBLEMS+=("drive has $SMART_PENDING pending sectors")
[ "$SMART_OK" = "CHECK" ]           && PROBLEMS+=("SMART health is not PASSED")
[ -n "$CERT_DAYS" ] && [ "$CERT_DAYS" -lt 14 ] && PROBLEMS+=("TLS cert expires in ${CERT_DAYS}d")
[ -n "$THROTTLED" ] && [ "$THROTTLED" != "0x0" ] && PROBLEMS+=("power/thermal throttling flagged ($THROTTLED)")

STATUS=ok; [ ${#PROBLEMS[@]} -gt 0 ] && STATUS=degraded

PROBLEM_JSON=$(printf '%s\n' "${PROBLEMS[@]:-}" | grep -v '^$' | \
  awk 'BEGIN{ORS=""} {gsub(/"/,"\\\""); printf "%s\"%s\"", (NR>1?",":""), $0}')

# --- emit ----------------------------------------------------------------
read -r -d '' JSON <<EOF || true
{
  "status": $(jstr "$STATUS"),
  "problems": [$PROBLEM_JSON],
  "checked_at": $(jstr "$(date -u +%Y-%m-%dT%H:%M:%SZ)"),
  "host": $(jstr "$(hostname)"),
  "app": {
    "service": $(jstr "$RANCH_STATE"),
    "http_status": $(jnum "${HTTP_CODE:-}"),
    "response_ms": $(jnum "${HTTP_MS:-}"),
    "api_status": $(jnum "${API_CODE:-}"),
    "commit": $(jstr "$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null)")
  },
  "web": {
    "caddy": $(jstr "$CADDY_STATE"),
    "cert_days_remaining": $(jnum "${CERT_DAYS:-}")
  },
  "disk": {
    "root_pct_used": $(jnum "${root_pct:-}"),
    "root_avail_gb": $(jnum "${root_avail:-}"),
    "data_pct_used": $(jnum "${data_pct:-}"),
    "data_avail_gb": $(jnum "${data_avail:-}"),
    "data_mounted": $(jbool "$data_mounted")
  },
  "drive": {
    "smart_health": $(jstr "$SMART_OK"),
    "reallocated_sectors": $(jnum "${SMART_REALLOC:-}"),
    "pending_sectors": $(jnum "${SMART_PENDING:-}"),
    "temperature_c": $(jnum "${SMART_TEMP:-}"),
    "power_on_hours": $(jnum "${SMART_HOURS:-}")
  },
  "database": {
    "integrity_ok": $(jbool "$DB_OK"),
    "size_bytes": $(jnum "${DB_BYTES:-}"),
    "bookings": $(jnum "${BOOKINGS:-}"),
    "pending_bookings": $(jnum "${PENDING:-}")
  },
  "backups": {
    "count": $(jnum "${BACKUP_COUNT:-0}"),
    "newest_age_hours": $(jnum "${BACKUP_AGE_H:-}")
  },
  "system": {
    "uptime_seconds": $(jnum "${UPTIME_S:-}"),
    "load_1min": $(jnum "${LOAD1:-}"),
    "mem_available_mb": $(jnum "${MEM_AVAIL_MB:-}"),
    "cpu_temp_c": $(jnum "${CPU_TEMP:-}"),
    "throttled_flags": $(jstr "${THROTTLED:-}")
  }
}
EOF

if [ -n "$OUT" ]; then
  TMP="${OUT}.tmp.$$"
  printf '%s\n' "$JSON" > "$TMP" && mv -f "$TMP" "$OUT"
  chmod 644 "$OUT"
else
  printf '%s\n' "$JSON"
fi

[ "$STATUS" = "ok" ] || exit 1
exit 0
