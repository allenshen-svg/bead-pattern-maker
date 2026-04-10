#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
deploy_host=${PINDOU_DEPLOY_HOST:-root@47.83.165.131}
web_root=${PINDOU_WEB_ROOT:-/opt/pindou-web}
api_root=${PINDOU_API_ROOT:-/opt/pindou-api}
service_name=${PINDOU_SERVICE_NAME:-pindou-api}
stamp=$(date +%Y%m%d-%H%M%S)
stage_root=/opt/pindou-stage/$stamp
backup_root=/opt/pindou-deploy-backups/$stamp

manifest_file=$(mktemp)
trap 'rm -f "$manifest_file"' EXIT

append_path() {
  local rel_path=$1
  if [[ -e "$repo_root/$rel_path" ]]; then
    printf '%s\n' "$rel_path" >>"$manifest_file"
  fi
}

append_path backend/server.py
append_path backend/requirements.txt
append_path backend/gunicorn.conf.py
append_path admin.html
append_path index.html
append_path site.webmanifest
append_path robots.txt
append_path sitemap.xml
append_path CNAME
append_path google97f6bc8e32a8d5c8.html
append_path c185c07e0fe9d75a0bbe9720e2a2400f.txt
append_path android-chrome-192x192.png
append_path android-chrome-512x512.png
append_path apple-touch-icon.png
append_path favicon-16x16.png
append_path favicon-32x32.png
append_path favicon-48x48.png
append_path favicon.ico
append_path og-image.png
append_path css
append_path js
append_path img
append_path images

if [[ ! -s "$manifest_file" ]]; then
  echo 'Nothing to deploy.' >&2
  exit 1
fi

ssh "$deploy_host" "set -e; mkdir -p '$backup_root/api' '$backup_root/web' '$stage_root'"

tar -C "$repo_root" -cf - -T "$manifest_file" | ssh "$deploy_host" "set -e; tar -C '$stage_root' -xf -"

ssh "$deploy_host" "set -e
backup_file() {
  local src=\$1
  local dst=\$2
  if [ -f \"\$src\" ]; then
    mkdir -p \"\$(dirname \"\$dst\")\"
    cp \"\$src\" \"\$dst\"
  fi
}
backup_dir() {
  local src=\$1
  local dst=\$2
  if [ -d \"\$src\" ]; then
    mkdir -p \"\$dst\"
    cp -a \"\$src/.\" \"\$dst/\"
  fi
}

backup_file '$api_root/server.py' '$backup_root/api/server.py'
backup_file '$api_root/requirements.txt' '$backup_root/api/requirements.txt'
backup_file '$api_root/gunicorn.conf.py' '$backup_root/api/gunicorn.conf.py'
backup_file '$api_root/admin.html' '$backup_root/api/admin.html'
backup_file '$web_root/index.html' '$backup_root/web/index.html'
backup_file '$web_root/site.webmanifest' '$backup_root/web/site.webmanifest'
backup_file '$web_root/robots.txt' '$backup_root/web/robots.txt'
backup_file '$web_root/sitemap.xml' '$backup_root/web/sitemap.xml'
backup_file '$web_root/CNAME' '$backup_root/web/CNAME'
backup_file '$web_root/google97f6bc8e32a8d5c8.html' '$backup_root/web/google97f6bc8e32a8d5c8.html'
backup_file '$web_root/c185c07e0fe9d75a0bbe9720e2a2400f.txt' '$backup_root/web/c185c07e0fe9d75a0bbe9720e2a2400f.txt'
backup_file '$web_root/android-chrome-192x192.png' '$backup_root/web/android-chrome-192x192.png'
backup_file '$web_root/android-chrome-512x512.png' '$backup_root/web/android-chrome-512x512.png'
backup_file '$web_root/apple-touch-icon.png' '$backup_root/web/apple-touch-icon.png'
backup_file '$web_root/favicon-16x16.png' '$backup_root/web/favicon-16x16.png'
backup_file '$web_root/favicon-32x32.png' '$backup_root/web/favicon-32x32.png'
backup_file '$web_root/favicon-48x48.png' '$backup_root/web/favicon-48x48.png'
backup_file '$web_root/favicon.ico' '$backup_root/web/favicon.ico'
backup_file '$web_root/og-image.png' '$backup_root/web/og-image.png'
backup_dir '$web_root/css' '$backup_root/web/css'
backup_dir '$web_root/js' '$backup_root/web/js'
backup_dir '$web_root/img' '$backup_root/web/img'
backup_dir '$web_root/images' '$backup_root/web/images'

install -m 0644 '$stage_root/backend/server.py' '$api_root/server.py'
install -m 0644 '$stage_root/backend/requirements.txt' '$api_root/requirements.txt'
if [ -f '$stage_root/backend/gunicorn.conf.py' ]; then
  install -m 0644 '$stage_root/backend/gunicorn.conf.py' '$api_root/gunicorn.conf.py'
fi
if [ -f '$stage_root/admin.html' ]; then
  install -m 0644 '$stage_root/admin.html' '$api_root/admin.html'
fi
if [ -f '$stage_root/index.html' ]; then
  install -m 0644 '$stage_root/index.html' '$web_root/index.html'
fi
if [ -f '$stage_root/site.webmanifest' ]; then
  install -m 0644 '$stage_root/site.webmanifest' '$web_root/site.webmanifest'
fi
for root_file in robots.txt sitemap.xml CNAME google97f6bc8e32a8d5c8.html c185c07e0fe9d75a0bbe9720e2a2400f.txt android-chrome-192x192.png android-chrome-512x512.png apple-touch-icon.png favicon-16x16.png favicon-32x32.png favicon-48x48.png favicon.ico og-image.png; do
  if [ -f '$stage_root/'\"\$root_file\" ]; then
    install -m 0644 '$stage_root/'\"\$root_file\" '$web_root/'\"\$root_file\"
  fi
done
if [ -d '$stage_root/css' ]; then
  mkdir -p '$web_root/css'
  cp -a '$stage_root/css/.' '$web_root/css/'
fi
if [ -d '$stage_root/js' ]; then
  mkdir -p '$web_root/js'
  cp -a '$stage_root/js/.' '$web_root/js/'
fi
if [ -d '$stage_root/img' ]; then
  mkdir -p '$web_root/img'
  cp -a '$stage_root/img/.' '$web_root/img/'
fi
if [ -d '$stage_root/images' ]; then
  mkdir -p '$web_root/images'
  cp -a '$stage_root/images/.' '$web_root/images/'
fi

cd '$api_root'
./venv/bin/pip install -r requirements.txt
systemctl restart '$service_name'
systemctl is-active '$service_name'
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:8081/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -fsS http://127.0.0.1:8081/api/health >/dev/null
echo 'Deployed at $stamp'
echo 'Backup: $backup_root'
"