# Logs & diagnostics — AV Ranch on the Pi

Every command here runs **on the Pi**. Get there with:

```bash
ssh will_clore1@willspi.local
```

Or run any single command without logging in first:

```bash
ssh will_clore1@willspi.local 'journalctl -u ranch -n 50 --no-pager'
```

> `journalctl` needs no `sudo` — `will_clore1` is in the `adm` group. Only
> Caddy's access log does, because Caddy writes it `600` as its own user.

---

## Start here

Nine times out of ten this is the command you want:

```bash
journalctl -u ranch -n 100 --no-pager
```

And to watch it live while you reproduce something:

```bash
journalctl -u ranch -f
```

If the app itself looks fine, the next question is whether the request even
reached it — that's Caddy, one section down.

---

## Where everything lives

| What | Where | Read it with |
|---|---|---|
| App (Node/Express) | journald, unit `ranch` | `journalctl -u ranch` |
| Web server / TLS | journald, unit `caddy` | `journalctl -u caddy` |
| HTTP requests | `/var/log/caddy/ranch-access.log` (JSON) | `sudo tail` + `jq` |
| Nightly DB backup | journald, unit `ranch-backup` | `journalctl -u ranch-backup` |
| Health snapshot job | journald, unit `ranch-health` | `journalctl -u ranch-health` |
| Current health | `/mnt/data/health/health.json` | `jq . /mnt/data/health/health.json` |
| DuckDNS failures | journald, tag `duckdns` | `journalctl -t duckdns` |
| Firewall blocks | journald (kernel) | `journalctl -k | grep UFW` |
| Login attempts | journald, unit `ssh` | `journalctl -u ssh` |

---

## The app

```bash
journalctl -u ranch -n 100 --no-pager     # last 100 lines
journalctl -u ranch -f                     # follow live
journalctl -u ranch -p err                 # errors only
journalctl -u ranch --since "1 hour ago"
journalctl -u ranch --since today
journalctl -u ranch --since "2026-08-26 14:00" --until "2026-08-26 15:00"
```

Is it even running, and did it restart recently?

```bash
systemctl status ranch
systemctl is-active ranch
```

Restart it, and watch it come back up:

```bash
sudo systemctl restart ranch && journalctl -u ranch -f
```

Crash loop? `Restart=always` means systemd keeps relaunching it, so the symptom
is the same start banner over and over:

```bash
journalctl -u ranch --since "10 min ago" | grep -c "AV Ranch running"
```

More than a handful means it is failing and being restarted — read the lines
just above each banner for the actual error.

---

## The web server (Caddy)

Service log — TLS renewals, config reloads, upstream failures:

```bash
journalctl -u caddy -n 100 --no-pager
journalctl -u caddy -f
journalctl -u caddy | grep -i "certificate\|acme\|obtain\|renew"
```

Access log — one JSON object per request. Needs `sudo`:

```bash
sudo tail -f /var/log/caddy/ranch-access.log | jq -r '"\(.status) \(.request.method) \(.request.uri)"'
```

Just the errors:

```bash
sudo jq -r 'select(.status >= 400) | "\(.ts|todate) \(.status) \(.request.method) \(.request.uri)"' \
  /var/log/caddy/ranch-access.log | tail -40
```

Slowest requests:

```bash
sudo jq -r '"\(.duration) \(.request.uri)"' /var/log/caddy/ranch-access.log \
  | sort -rn | head -20
```

Busiest paths:

```bash
sudo jq -r '.request.uri' /var/log/caddy/ranch-access.log | sort | uniq -c | sort -rn | head -20
```

Who is hitting the site (it is on the public internet — expect scanners):

```bash
sudo jq -r '.request.remote_ip' /var/log/caddy/ranch-access.log | sort | uniq -c | sort -rn | head -20
```

Caddy rotates this itself at 10 MB, keeping 5 files, so it is capped near 50 MB
and needs no logrotate entry.

---

## Backups

```bash
journalctl -u ranch-backup -n 30 --no-pager   # what the last runs did
systemctl list-timers ranch-backup.timer      # when the next one is
ls -lh /mnt/data/backups/                     # what actually exists
```

Run one right now:

```bash
sudo systemctl start ranch-backup && journalctl -u ranch-backup -n 5 --no-pager
```

---

## Health

The snapshot the daily check reads, refreshed every 5 minutes:

```bash
jq . /mnt/data/health/health.json
```

Just the verdict:

```bash
jq -r '"\(.status)  \(.problems | join("; "))"' /mnt/data/health/health.json
```

Run the full check by hand — this is the most useful single diagnostic on the
box, covering services, disks, drive SMART, DB integrity, backups and TLS:

```bash
/mnt/data/ranch/scripts/health-check.sh
```

The job that writes the file:

```bash
journalctl -u ranch-health -n 20 --no-pager
systemctl list-timers ranch-health.timer
```

If `checked_at` is more than a few minutes old, the timer has stopped — check
that unit rather than trusting the stale numbers.

---

## DNS

Only failures are logged, so **silence here is good**:

```bash
journalctl -t duckdns --since today
```

Force an update and see the result:

```bash
/usr/local/bin/duckdns-update
```

Confirm DNS actually points at this house:

```bash
dig +short ranch-booking.duckdns.org      # should match the line below
curl -s https://api.ipify.org; echo        # this network's public IP
```

If those two disagree, the site is unreachable from outside **and** the
certificate will fail to renew.

---

## Disk (this is what took the server down once)

A runaway log filled the SD card to 100% and killed everything. Checking:

```bash
df -h /                      # the SD card — OS and logs
df -h /mnt/data              # the USB drive — app, database, backups
sudo du -sh /var/log/* | sort -rh | head -10
```

Journal size, and its cap:

```bash
journalctl --disk-usage
cat /etc/systemd/journald.conf.d/size-cap.conf
```

Everything is bounded now — journal 200 MB, Caddy 50 MB, `logrotate` on
`/var/log/cserver` — but this is the first thing to check if the Pi acts strange.

Reclaim journal space immediately if you ever need to:

```bash
sudo journalctl --vacuum-size=100M
```

---

## System

```bash
journalctl -f                              # everything, live
journalctl -p err --since today            # today's errors, all units
journalctl -b -p err                       # errors since last boot
journalctl --list-boots                    # reboot history
uptime
vcgencmd get_throttled                     # 0x0 = healthy power and temp
vcgencmd measure_temp
```

Firewall blocks (noisy — the box is publicly exposed):

```bash
journalctl -k --since "1 hour ago" | grep "UFW BLOCK" | tail -20
sudo ufw status verbose
```

SSH login attempts and what fail2ban is banning:

```bash
journalctl -u ssh --since today | grep -i "failed\|accepted" | tail -20
sudo fail2ban-client status
```

---

## Deploys

`update.sh` prints what it did and rolls back on failure, so read its output
first. If a deploy went wrong afterwards:

```bash
journalctl -u ranch --since "10 min ago"        # did it come back up?
cd /mnt/data/ranch && git log --oneline -5      # what is actually deployed
./scripts/update.sh --check                     # what an update would do
```

---

## Cheat sheet

```bash
journalctl -u ranch -f                                  # app, live
journalctl -u ranch -p err --since today                # app errors today
journalctl -u caddy -f                                  # web server, live
sudo tail -f /var/log/caddy/ranch-access.log | jq -c .  # requests, live
jq . /mnt/data/health/health.json                       # current health
/mnt/data/ranch/scripts/health-check.sh                 # full check now
journalctl -t duckdns --since today                     # DNS failures
df -h / /mnt/data                                       # disk
journalctl -p err --since today                         # everything broken today
```
