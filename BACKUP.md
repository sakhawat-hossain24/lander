# Lander — Daily Backup

**Reminder: back up your Lander data every day.**

`lander.db` is ignored by git (`.gitignore`) and is never pushed to the public repo. If you run Lander locally or on a VPS, you must back it up separately.

## Daily automated backup (on this machine)

- Script: `scripts/backup.sh`
- Schedule: systemd user timer `lander-backup.timer` — runs daily at **21:00 local time**, `Persistent=true` (runs on next login if the PC was off).
- Destination: `~/lander-backups/lander-YYYY-MM-DD-HHMM.db` (keeps 7 days, auto-deletes older)
- Desktop notification on success; check with:

```bash
~/Projects/lander/scripts/backup.sh
systemctl --user list-timers lander-backup.timer
journalctl --user -u lander-backup.service --no-pager -n 20
```

## Manual backup

```bash
./scripts/backup.sh
# or plain copy (stop the server first for a consistent copy)
cp lander.db ~/lander-backups/lander-$(date +%F).db
```

## Restore

```bash
cp ~/lander-backups/lander-YYYY-MM-DD.db ./lander.db
# then restart: python -m uvicorn app:app --reload
```

## Notes for public / cloud deploys

- The repo stays public-safe: code + `examples/` only.
- The DB volume (`lander-data:/app/data` in `docker-compose.yml`) lives on your server, not in git.
- For off-site copy, sync `~/lander-backups/` with rclone to S3 / Google Drive.
