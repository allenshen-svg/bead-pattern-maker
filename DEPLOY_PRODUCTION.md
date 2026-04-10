# Production Deploy

## Current layout

- Frontend document root: `/opt/pindou-web`
- API app root: `/opt/pindou-api`
- API service: `pindou-api.service`
- Secrets file: `/etc/pindou-api.env`
- Backups: `/opt/pindou-deploy-backups/<timestamp>`

## Versioned backend files

- `backend/server.py`
- `backend/requirements.txt`
- `backend/gunicorn.conf.py`
- `backend/data/.gitignore`

`backend/data/` stays untracked so the SQLite database is never shipped from local to production.

## One-command deploy

Run from the repo root:

```bash
./scripts/deploy_prod.sh
```

The script will:

1. Create a timestamped backup on the server.
2. Upload the current repo payload into a staging directory.
3. Promote backend and frontend files into `/opt/pindou-api` and `/opt/pindou-web`.
4. Install Python dependencies.
5. Restart `pindou-api.service`.
6. Verify `http://127.0.0.1:8081/api/health` on the server.

## Gunicorn service

- Committed unit template: `scripts/pindou-api.service`
- Example env file: `scripts/pindou-api.env.example`

Production keeps real secrets in `/etc/pindou-api.env`, not in the repo.

## Service install/update

```bash
scp scripts/pindou-api.service root@47.83.165.131:/etc/systemd/system/pindou-api.service
scp scripts/pindou-api.env.example root@47.83.165.131:/etc/pindou-api.env
ssh root@47.83.165.131 "systemctl daemon-reload && systemctl restart pindou-api && systemctl status pindou-api --no-pager"
```

Replace `/etc/pindou-api.env` with real production values before restarting.

## Smoke checks

```bash
curl -s https://api.pindou.top/api/health
curl -s https://pindou.top | grep 'inviteModal'
curl -s -i 'https://api.pindou.top/api/invite/validate?code=PIN666' | head
```