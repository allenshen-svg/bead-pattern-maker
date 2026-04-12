#!/usr/bin/env python3
"""
拼豆图案生成器 — 后端 API
用户系统 + 豆子系统（邮箱验证码注册/登录）
"""

import os
import re
import time
import json
import html
import base64
import hmac
import hashlib
import random
import string
import sqlite3
import smtplib
import threading
from io import BytesIO
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta, timezone
from functools import wraps
from urllib.parse import quote, urlparse

import jwt
import bcrypt
import requests
from flask import Flask, request, jsonify, g, send_file
from PIL import Image, ImageStat
try:
    from flask_cors import CORS
except ImportError:
    CORS = None

try:
    RESAMPLE_NEAREST = Image.Resampling.NEAREST
except AttributeError:
    RESAMPLE_NEAREST = Image.NEAREST

# ── Config ──
SECRET_KEY = os.environ.get('PINDOU_SECRET', 'pindou-secret-change-me-in-prod')
ADMIN_KEY = os.environ.get('PINDOU_ADMIN_KEY', 'pindou-admin-2024')
SMTP_HOST = os.environ.get('SMTP_HOST', 'smtp.qq.com')
SMTP_PORT = int(os.environ.get('SMTP_PORT', '465'))
SMTP_USER = os.environ.get('SMTP_USER', '')
SMTP_PASS = os.environ.get('SMTP_PASS', '')

# 收款码图片URL（微信/支付宝个人收款码）
PAY_QRCODE_WECHAT = os.environ.get('PAY_QRCODE_WECHAT', 'https://api.pindou.top/static/wechat_qr.jpg')
PAY_QRCODE_ALIPAY = os.environ.get('PAY_QRCODE_ALIPAY', 'https://api.pindou.top/static/alipay_qr.jpg')

# 充值套餐
RECHARGE_PACKAGES = {
    'beans_10':  {'name': '10 豆子',  'beans': 10,  'price': '3.00',  'type': 'beans'},
    'beans_30':  {'name': '30 豆子',  'beans': 30,  'price': '8.00',  'type': 'beans'},
    'beans_100': {'name': '100 豆子', 'beans': 100, 'price': '19.00', 'type': 'beans'},
    'monthly':   {'name': '月卡会员', 'beans': 150, 'price': '9.90',  'type': 'member', 'days': 30},
    'yearly':    {'name': '年卡会员', 'beans': 1800, 'price': '68.00', 'type': 'member', 'days': 365},
}
SMTP_FROM_NAME = '拼豆图案生成器'
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'pindou.db')
NEW_USER_BEANS = 10
DAILY_CHECKIN_BEANS = 1
INVITEE_REGISTER_BONUS = 2
INVITER_ACTIVATE_BONUS = 4
INVITE_CODE_LENGTH = 6
INVITE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
INVITE_IP_WINDOW_HOURS = 24
INVITE_IP_REWARD_LIMIT = 2
CLIENT_FINGERPRINT_HEADER = 'X-Client-Fingerprint'
CODE_EXPIRE_SEC = 300  # 5 minutes
JWT_EXPIRE_HOURS = 168  # 7 days
HTTP_TIMEOUT = 15
LOCAL_RESTORE_SCALE = max(8, min(int(os.environ.get('LOCAL_RESTORE_SCALE', '14')), 24))
SITE_URL = os.environ.get('PINDOU_SITE_URL', 'https://pindou.top').rstrip('/')
XHS_NOTE_HOSTS = ('xiaohongshu.com', 'xhslink.com')
XHS_IMAGE_HOSTS = ('xhscdn.com', 'xiaohongshu.com')
XHS_HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/124.0.0.0 Safari/537.36'
    ),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Referer': 'https://www.xiaohongshu.com/',
}
XHS_IMAGE_HEADERS = {
    'User-Agent': XHS_HEADERS['User-Agent'],
    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Accept-Language': XHS_HEADERS['Accept-Language'],
    'Referer': XHS_HEADERS['Referer'],
}
ALLOWED_CORS_ORIGINS = {
    'https://pindou.top',
    'https://www.pindou.top',
    'null',
}

app = Flask(__name__)
if CORS:
    CORS(app, supports_credentials=True)

@app.after_request
def add_cors_headers(response):
    origin = request.headers.get('Origin', '')
    allow_origin = ''
    if origin in ALLOWED_CORS_ORIGINS:
        allow_origin = origin
    elif origin.startswith('http://localhost:') or origin.startswith('http://127.0.0.1:'):
        allow_origin = origin

    if allow_origin:
        response.headers['Access-Control-Allow-Origin'] = allow_origin
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        response.headers['Vary'] = 'Origin'

    response.headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type, X-Admin-Key, X-Client-Fingerprint'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    return response

# ── Rate limiting (in-memory) ──
_rate_store = {}  # ip/email -> [timestamps]
_rate_lock = threading.Lock()
_schema_ready = False
_schema_lock = threading.Lock()

def _rate_limited(key, max_count, window_sec):
    """Return True if rate limited."""
    now = time.time()
    with _rate_lock:
        ts_list = _rate_store.get(key, [])
        ts_list = [t for t in ts_list if now - t < window_sec]
        if len(ts_list) >= max_count:
            return True
        ts_list.append(now)
        _rate_store[key] = ts_list
    return False

# ── Database ──
def get_db():
    if 'db' not in g:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
        g.db.execute("PRAGMA foreign_keys=ON")
        _ensure_schema(g.db)
    return g.db

@app.teardown_appcontext
def close_db(exception):
    db = g.pop('db', None)
    if db:
        db.close()

def init_db():
    """Create tables if not exist."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    _ensure_schema(db)
    db.close()

def _column_exists(db, table_name, column_name):
    rows = db.execute(f"PRAGMA table_info({table_name})").fetchall()
    return any(row[1] == column_name for row in rows)

def _gen_invite_code():
    return ''.join(random.choices(INVITE_CODE_CHARS, k=INVITE_CODE_LENGTH))

def _create_unique_invite_code(db):
    for _ in range(32):
        code = _gen_invite_code()
        if not db.execute("SELECT 1 FROM users WHERE invite_code=?", (code,)).fetchone():
            return code
    raise RuntimeError('邀请码生成失败，请稍后重试')

def _ensure_schema(db):
    global _schema_ready
    if _schema_ready:
        return

    with _schema_lock:
        if _schema_ready:
            return

        db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            nickname TEXT DEFAULT '',
            beans INTEGER DEFAULT 10,
            is_member INTEGER DEFAULT 0,
            member_expire TEXT DEFAULT '',
            monthly_beans INTEGER DEFAULT 0,
            register_ip TEXT DEFAULT '',
            register_fingerprint TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            last_login TEXT DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS verify_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            code TEXT NOT NULL,
            purpose TEXT NOT NULL,
            created_at TEXT NOT NULL,
            used INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS bean_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            delta INTEGER NOT NULL,
            reason TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        CREATE INDEX IF NOT EXISTS idx_codes_email ON verify_codes(email);

        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_no TEXT UNIQUE NOT NULL,
            user_id INTEGER NOT NULL,
            package_id TEXT NOT NULL,
            package_name TEXT NOT NULL,
            amount TEXT NOT NULL,
            beans INTEGER NOT NULL DEFAULT 0,
            member_days INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending',
            trade_no TEXT DEFAULT '',
            pay_time TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_orders_no ON orders(order_no);
        CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);

        CREATE TABLE IF NOT EXISTS invite_relations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            inviter_user_id INTEGER NOT NULL,
            invitee_user_id INTEGER UNIQUE NOT NULL,
            invite_code TEXT NOT NULL,
            invitee_reward INTEGER NOT NULL DEFAULT 0,
            inviter_reward INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'registered',
            block_reason TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            activated_at TEXT DEFAULT '',
            rewarded_at TEXT DEFAULT '',
            FOREIGN KEY (inviter_user_id) REFERENCES users(id),
            FOREIGN KEY (invitee_user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_invite_relations_inviter ON invite_relations(inviter_user_id);
        CREATE INDEX IF NOT EXISTS idx_invite_relations_status ON invite_relations(status);

        CREATE TABLE IF NOT EXISTS feature_clicks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            feature TEXT NOT NULL,
            page TEXT DEFAULT '',
            user_id INTEGER DEFAULT 0,
            ip TEXT DEFAULT '',
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_feature_clicks_feature ON feature_clicks(feature);
        CREATE INDEX IF NOT EXISTS idx_feature_clicks_created ON feature_clicks(created_at);
    """)

        if not _column_exists(db, 'users', 'invite_code'):
            db.execute("ALTER TABLE users ADD COLUMN invite_code TEXT DEFAULT ''")
        if not _column_exists(db, 'users', 'invited_by'):
            db.execute("ALTER TABLE users ADD COLUMN invited_by INTEGER")
        if not _column_exists(db, 'users', 'register_ip'):
            db.execute("ALTER TABLE users ADD COLUMN register_ip TEXT DEFAULT ''")
        if not _column_exists(db, 'users', 'register_fingerprint'):
            db.execute("ALTER TABLE users ADD COLUMN register_fingerprint TEXT DEFAULT ''")
        if not _column_exists(db, 'invite_relations', 'block_reason'):
            db.execute("ALTER TABLE invite_relations ADD COLUMN block_reason TEXT DEFAULT ''")

        missing_rows = db.execute("SELECT id FROM users WHERE COALESCE(invite_code, '')='' ORDER BY id ASC").fetchall()
        for row in missing_rows:
            db.execute("UPDATE users SET invite_code=? WHERE id=?", (_create_unique_invite_code(db), row['id']))

        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_code ON users(invite_code)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_users_register_ip ON users(register_ip)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_users_register_fingerprint ON users(register_fingerprint)")
        db.commit()
        _schema_ready = True

# ── Helpers ──
def _now_iso():
    return datetime.now(timezone.utc).isoformat()

def _gen_code():
    return ''.join(random.choices(string.digits, k=6))

def _send_email(to_email, subject, body_html):
    """Send email via SMTP."""
    if not SMTP_USER or not SMTP_PASS:
        app.logger.warning("SMTP not configured, code not sent to %s", to_email)
        return False
    msg = MIMEMultipart('alternative')
    msg['From'] = SMTP_USER
    msg['To'] = to_email
    msg['Subject'] = subject
    msg.attach(MIMEText(body_html, 'html', 'utf-8'))
    try:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=10) as s:
            s.login(SMTP_USER, SMTP_PASS)
            s.sendmail(SMTP_USER, to_email, msg.as_string())
        return True
    except Exception as e:
        app.logger.error("Email send failed: %s", e)
        return False

def _create_token(user_id, email):
    payload = {
        'uid': user_id,
        'email': email,
        'exp': datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm='HS256')

def _validate_email(email):
    return re.match(r'^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$', email)

def _normalize_invite_code(value):
    return re.sub(r'[^A-Z0-9]', '', (value or '').upper())[:12]

def _mask_inviter_label(email='', nickname=''):
    base = (nickname or '').strip() or (email or '').split('@')[0].strip() or '拼豆好友'
    if len(base) <= 1:
        return base + '*'
    if len(base) == 2:
        return base[0] + '*'
    return base[:2] + '*' * min(4, max(1, len(base) - 2))

def _invite_link(code):
    return f'{SITE_URL}/?invite={quote(code)}'

def _client_ip():
    forwarded = request.headers.get('X-Forwarded-For', '')
    raw = forwarded.split(',', 1)[0].strip() if forwarded else (request.remote_addr or '').strip()
    return raw[:64]

def _normalize_client_fingerprint(value):
    return re.sub(r'[^a-zA-Z0-9_-]', '', (value or '').strip()).lower()[:64]

def _client_fingerprint():
    return _normalize_client_fingerprint(request.headers.get(CLIENT_FINGERPRINT_HEADER, ''))

def _invite_block_reason_text(reason_code):
    messages = {
        'same_device': '同一设备上的邀请不计奖励',
        'device_used': '当前设备已领取过邀请码奖励',
        'same_ip': '同一网络下的邀请不计奖励',
        'ip_limit': f'当前网络 {INVITE_IP_WINDOW_HOURS} 小时内的邀请码奖励次数已达上限',
    }
    return messages.get(reason_code, '')

def _invite_block_reason(db, inviter_row, client_ip, client_fingerprint):
    inviter_ip = (inviter_row['register_ip'] or '').strip()
    inviter_fingerprint = _normalize_client_fingerprint(inviter_row['register_fingerprint'] or '')

    if client_fingerprint and inviter_fingerprint and client_fingerprint == inviter_fingerprint:
        return 'same_device'

    if client_ip and inviter_ip and client_ip == inviter_ip:
        return 'same_ip'

    if client_fingerprint:
        used_device = db.execute(
            """
            SELECT id FROM users
            WHERE invited_by IS NOT NULL AND COALESCE(register_fingerprint, '')=?
            ORDER BY id DESC LIMIT 1
            """,
            (client_fingerprint,)
        ).fetchone()
        if used_device:
            return 'device_used'

    if client_ip:
        window_start = (datetime.now(timezone.utc) - timedelta(hours=INVITE_IP_WINDOW_HOURS)).isoformat()
        recent_same_ip = db.execute(
            """
            SELECT COUNT(*) AS c FROM users
            WHERE invited_by IS NOT NULL
              AND COALESCE(register_ip, '')=?
              AND created_at >= ?
            """,
            (client_ip, window_start)
        ).fetchone()['c']
        if recent_same_ip >= INVITE_IP_REWARD_LIMIT:
            return 'ip_limit'

    return ''

def _backfill_user_identity(db, user_id, client_ip, client_fingerprint):
    row = db.execute(
        "SELECT register_ip, register_fingerprint FROM users WHERE id=?",
        (user_id,)
    ).fetchone()
    if not row:
        return

    updates = []
    values = []
    if client_ip and not (row['register_ip'] or '').strip():
        updates.append('register_ip=?')
        values.append(client_ip)
    if client_fingerprint and not _normalize_client_fingerprint(row['register_fingerprint'] or ''):
        updates.append('register_fingerprint=?')
        values.append(client_fingerprint)

    if not updates:
        return

    values.append(user_id)
    db.execute(f"UPDATE users SET {', '.join(updates)} WHERE id=?", values)

def _clamp_int(value, min_value, max_value, default):
    parsed = _safe_int(value)
    if parsed <= 0:
        return default
    return max(min_value, min(parsed, max_value))

def _decode_image_data_url(data_url):
    if not isinstance(data_url, str) or ',' not in data_url:
        raise ValueError('图片数据无效')
    header, payload = data_url.split(',', 1)
    if not header.startswith('data:image/'):
        raise ValueError('仅支持图片数据')
    try:
        raw = base64.b64decode(payload)
    except (ValueError, TypeError):
        raise ValueError('图片解码失败')
    try:
        with Image.open(BytesIO(raw)) as image:
            rgba = image.convert('RGBA')
    except Exception as e:
        raise ValueError('图片格式不支持') from e
    background = Image.new('RGBA', rgba.size, (255, 255, 255, 255))
    return Image.alpha_composite(background, rgba).convert('RGB')

def _encode_png_data_url(image):
    output = BytesIO()
    image.save(output, format='PNG', optimize=True)
    encoded = base64.b64encode(output.getvalue()).decode('ascii')
    return f'data:image/png;base64,{encoded}'

def _mean_color(image):
    stat = ImageStat.Stat(image)
    return tuple(max(0, min(255, int(round(channel)))) for channel in stat.mean[:3])

def _restore_pixel_source(image, bead_width):
    src = image.convert('RGB')
    src_w, src_h = src.size
    grid_w = _clamp_int(bead_width, 10, 240, 50)
    grid_h = max(10, round(grid_w * src_h / max(src_w, 1)))

    cell_w = src_w / grid_w
    cell_h = src_h / grid_h
    margin_ratio = 0.18

    small = Image.new('RGB', (grid_w, grid_h), '#ffffff')
    for grid_y in range(grid_h):
        for grid_x in range(grid_w):
            left = grid_x * cell_w
            top = grid_y * cell_h
            right = min(src_w, (grid_x + 1) * cell_w)
            bottom = min(src_h, (grid_y + 1) * cell_h)

            inner_left = left + cell_w * margin_ratio
            inner_top = top + cell_h * margin_ratio
            inner_right = right - cell_w * margin_ratio
            inner_bottom = bottom - cell_h * margin_ratio

            if inner_right - inner_left < 1 or inner_bottom - inner_top < 1:
                inner_left, inner_top, inner_right, inner_bottom = left, top, right, bottom

            sample_box = (
                max(0, int(round(inner_left))),
                max(0, int(round(inner_top))),
                min(src_w, max(int(round(inner_left)) + 1, int(round(inner_right)))),
                min(src_h, max(int(round(inner_top)) + 1, int(round(inner_bottom)))),
            )
            patch = src.crop(sample_box)
            small.putpixel((grid_x, grid_y), _mean_color(patch))

    scale_cap = max(1, 2400 // max(grid_w, grid_h))
    preview_scale = max(6, min(LOCAL_RESTORE_SCALE, scale_cap))
    restored = small.resize((grid_w * preview_scale, grid_h * preview_scale), RESAMPLE_NEAREST)
    return small, restored

def _activate_invite_reward(db, invitee_user_id, now):
    relation = db.execute(
        """
        SELECT id, inviter_user_id, inviter_reward, status
        FROM invite_relations
        WHERE invitee_user_id=?
        ORDER BY id DESC LIMIT 1
        """,
        (invitee_user_id,)
    ).fetchone()
    if not relation or relation['status'] == 'rewarded':
        return 0

    reward = max(0, _safe_int(relation['inviter_reward']))
    db.execute(
        "UPDATE invite_relations SET status='rewarded', activated_at=?, rewarded_at=? WHERE id=?",
        (now, now, relation['id'])
    )
    if reward <= 0:
        return 0

    db.execute("UPDATE users SET beans = beans + ? WHERE id=?", (reward, relation['inviter_user_id']))
    db.execute(
        "INSERT INTO bean_log (user_id, delta, reason, created_at) VALUES (?,?,?,?)",
        (relation['inviter_user_id'], reward, '邀请好友首次生成奖励', now)
    )
    return reward

def _safe_int(value):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0

def _clean_text(value, limit=200):
    if not isinstance(value, str):
        return ''
    collapsed = ' '.join(value.split()).strip()
    return collapsed[:limit]

def _host_matches(hostname, allowed_hosts):
    host = (hostname or '').split(':', 1)[0].lower()
    return any(host == allowed or host.endswith(f'.{allowed}') for allowed in allowed_hosts)

def _extract_url_from_text(raw_text):
    text = (raw_text or '').strip()
    if not text:
        return ''
    patterns = [
        r'https?://[^\s]+',
        r'(?:xhslink\.com|(?:www\.)?xiaohongshu\.com)[^\s]+',
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if not match:
            continue
        url = match.group(0).strip().rstrip(')】]>,，。；;!！?？')
        if not url.startswith('http'):
            url = f'https://{url}'
        return url
    return ''

def _normalize_xhs_url(raw_text):
    url = _extract_url_from_text(raw_text)
    if not url:
        raise ValueError('请粘贴小红书帖子链接或分享文案')
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https') or not _host_matches(parsed.netloc, XHS_NOTE_HOSTS):
        raise ValueError('目前只支持导入小红书帖子链接')
    return url

def _clean_remote_url(url):
    if not isinstance(url, str):
        return ''
    cleaned = html.unescape(url).replace('\\u002F', '/').replace('\\/', '/').strip()
    if cleaned.startswith('//'):
        cleaned = f'https:{cleaned}'
    if cleaned.startswith('http://'):
        try:
            parsed = urlparse(cleaned)
            if _host_matches(parsed.netloc, XHS_IMAGE_HOSTS):
                cleaned = parsed._replace(scheme='https').geturl()
        except ValueError:
            return ''
    return cleaned

def _normalize_note_title(value):
    title = _clean_text(value, 120)
    if not title:
        return ''
    title = re.sub(r'\s*[-_]\s*小红书$', '', title)
    if any(token in title for token in ('沪ICP备', '营业执照')):
        return ''
    if title.startswith('小红书_'):
        return ''
    return title.strip(' -_')

def _extract_html_title(html_text):
    match = re.search(r'<title[^>]*>(.*?)</title>', html_text, re.IGNORECASE | re.DOTALL)
    if not match:
        return ''
    return _normalize_note_title(html.unescape(match.group(1)))

def _media_dedupe_key(url):
    cleaned = _clean_remote_url(url)
    if not cleaned:
        return ''
    try:
        parsed = urlparse(cleaned)
    except ValueError:
        return ''
    tail = parsed.path.rsplit('/', 1)[-1].split('!', 1)[0].lower()
    return tail or parsed.path.lower()

def _looks_like_xhs_image(url):
    cleaned = _clean_remote_url(url)
    if not cleaned.startswith(('http://', 'https://')):
        return False
    try:
        parsed = urlparse(cleaned)
    except ValueError:
        return False
    path = parsed.path.lower()
    tail = path.rsplit('/', 1)[-1]
    if not _host_matches(parsed.netloc, XHS_IMAGE_HOSTS):
        return False
    if any(token in path for token in ('avatar', 'profile', 'icon', 'logo', 'emoji')):
        return False
    if 'fe-platform' in path:
        return False
    if any(tail.endswith(ext) for ext in ('.js', '.css', '.mp4', '.m3u8', '.json', '.html', '.pdf', '.ico', '.svg')):
        return False
    if not any(token in path for token in ('note', 'sns-webpic', 'sns-avatar', 'explore', '!nd_')):
        if not any(tail.endswith(ext) for ext in ('.jpg', '.jpeg', '.png', '.webp', '.gif')):
            return False
    return True

def _json_from_script_blob(raw_blob):
    cleaned = (raw_blob or '').strip()
    if not cleaned:
        return None
    cleaned = cleaned.rstrip(';').replace('undefined', 'null')
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return None

def _extract_embedded_states(html_text):
    states = []
    seen = set()
    patterns = [
        r'window\.__INITIAL_STATE__\s*=\s*(.+?)</script>',
        r'window\.__INITIAL_SSR_STATE__\s*=\s*(.+?)</script>',
        r'window\.__INITIAL_DATA__\s*=\s*(.+?)</script>',
        r'window\.__INITIAL_SSR_DATA__\s*=\s*(.+?)</script>',
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, html_text, re.DOTALL | re.IGNORECASE):
            blob = match.group(1)
            fingerprint = hashlib.sha1(blob[:4000].encode('utf-8', 'ignore')).hexdigest()
            if fingerprint in seen:
                continue
            parsed = _json_from_script_blob(blob)
            if parsed is None:
                continue
            seen.add(fingerprint)
            states.append(parsed)
    return states

def _extract_meta_content(html_text, attr_name, attr_value):
    patterns = [
        rf'<meta[^>]+{attr_name}=["\']{re.escape(attr_value)}["\'][^>]+content=["\'](.*?)["\']',
        rf'<meta[^>]+content=["\'](.*?)["\'][^>]+{attr_name}=["\']{re.escape(attr_value)}["\']',
    ]
    for pattern in patterns:
        match = re.search(pattern, html_text, re.IGNORECASE | re.DOTALL)
        if match:
            return _clean_text(html.unescape(match.group(1)), 200)
    return ''

def _add_image_candidate(images, url, width=0, height=0):
    cleaned = _clean_remote_url(url)
    if not _looks_like_xhs_image(cleaned):
        return
    width = _safe_int(width)
    height = _safe_int(height)
    if width and height:
        if width < 240 and height < 240:
            return
        ratio = width / max(height, 1)
        if ratio > 4 or ratio < 0.25:
            return
    key = _media_dedupe_key(cleaned)
    if not key:
        return
    score = width * height
    current = images.get(key)
    if current and current.get('score', 0) >= score:
        return
    images[key] = {
        'raw_url': cleaned,
        'width': width,
        'height': height,
        'score': score,
    }

def _collect_xhs_note_data(node, images, meta):
    if isinstance(node, dict):
        for key in ('displayTitle', 'title', 'noteTitle', 'shareTitle'):
            if meta['title']:
                break
            value = _normalize_note_title(node.get(key))
            if len(value) >= 2:
                meta['title'] = value
        for key in ('desc', 'description', 'noteDesc', 'content'):
            if meta['description']:
                break
            value = _clean_text(node.get(key), 240)
            if len(value) >= 4:
                meta['description'] = value

        width = _safe_int(
            node.get('width') or node.get('imageWidth') or node.get('widthPx') or node.get('originWidth')
        )
        height = _safe_int(
            node.get('height') or node.get('imageHeight') or node.get('heightPx') or node.get('originHeight')
        )
        for key, value in node.items():
            if isinstance(value, str) and ('url' in key.lower() or key.lower().endswith('src')):
                _add_image_candidate(images, value, width, height)
            elif isinstance(value, (dict, list)):
                _collect_xhs_note_data(value, images, meta)
    elif isinstance(node, list):
        for item in node:
            _collect_xhs_note_data(item, images, meta)

def _fetch_xhs_note(raw_text):
    note_url = _normalize_xhs_url(raw_text)
    response = requests.get(note_url, headers=XHS_HEADERS, timeout=HTTP_TIMEOUT, allow_redirects=True)
    response.raise_for_status()

    final_url = response.url
    if not _host_matches(urlparse(final_url).netloc, XHS_NOTE_HOSTS):
        raise ValueError('小红书链接解析失败，请直接粘贴帖子原链接')

    html_text = response.text or ''
    states = _extract_embedded_states(html_text)
    meta = {'title': '', 'description': ''}
    images = {}

    for state in states:
        _collect_xhs_note_data(state, images, meta)

    preferred_title = (
        _extract_html_title(html_text)
        or _normalize_note_title(_extract_meta_content(html_text, 'property', 'og:title'))
        or _normalize_note_title(_extract_meta_content(html_text, 'name', 'og:title'))
        or _normalize_note_title(_extract_meta_content(html_text, 'name', 'twitter:title'))
    )
    if preferred_title:
        meta['title'] = preferred_title
    if not meta['description']:
        meta['description'] = (
            _extract_meta_content(html_text, 'property', 'og:description')
            or _extract_meta_content(html_text, 'name', 'og:description')
            or _extract_meta_content(html_text, 'name', 'description')
        )

    og_image = (
        _extract_meta_content(html_text, 'property', 'og:image')
        or _extract_meta_content(html_text, 'name', 'og:image')
        or _extract_meta_content(html_text, 'name', 'twitter:image')
    )
    if og_image:
        _add_image_candidate(images, og_image)

    ranked_images = sorted(images.values(), key=lambda item: item.get('score', 0), reverse=True)
    if not ranked_images:
        raise ValueError('暂时没能解析出帖子图片，请换一个公开帖子链接再试')

    return {
        'title': meta['title'] or '小红书帖子',
        'description': meta['description'],
        'source_url': final_url,
        'images': ranked_images[:12],
    }

def auth_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            return jsonify({'error': '请先登录'}), 401
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
            g.user_id = payload['uid']
            g.user_email = payload['email']
        except jwt.ExpiredSignatureError:
            return jsonify({'error': '登录已过期，请重新登录'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'error': '无效的登录凭证'}), 401
        return f(*args, **kwargs)
    return decorated

# ── API Routes ──

@app.route('/api/health')
def health():
    return jsonify({'status': 'ok', 'service': 'pindou-api'})

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static')

@app.route('/static/<path:filename>')
def serve_static(filename):
    """Serve static files (QR codes etc). Only allow image files."""
    if not re.match(r'^[\w\-]+\.(jpg|jpeg|png|gif|webp)$', filename):
        return jsonify({'error': 'not found'}), 404
    filepath = os.path.join(STATIC_DIR, filename)
    if not os.path.isfile(filepath):
        return jsonify({'error': 'not found'}), 404
    return send_file(filepath)

@app.route('/admin')
def serve_admin():
    admin_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'admin.html')
    return send_file(admin_path)

# ── Send verification code ──
@app.route('/api/auth/send-code', methods=['POST'])
def send_code():
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    purpose = data.get('purpose', 'register')  # register | login | reset

    if not email or not _validate_email(email):
        return jsonify({'error': '请输入有效的邮箱地址'}), 400

    # Rate limit: 1 code per 60s per email, 5 per hour per IP
    client_ip = request.headers.get('X-Forwarded-For', request.remote_addr)
    if _rate_limited(f'code:{email}', 1, 60):
        return jsonify({'error': '发送太频繁，请60秒后再试'}), 429
    if _rate_limited(f'code_ip:{client_ip}', 5, 3600):
        return jsonify({'error': '请求次数过多，请稍后再试'}), 429

    db = get_db()

    # Check if registering with existing email
    if purpose == 'register':
        row = db.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
        if row:
            return jsonify({'error': '该邮箱已注册，请直接登录'}), 409

    code = _gen_code()
    db.execute("INSERT INTO verify_codes (email, code, purpose, created_at) VALUES (?,?,?,?)",
               (email, code, purpose, _now_iso()))
    db.commit()

    subject = f'【拼豆工具】验证码 {code}'
    body = f"""
    <div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:20px;">
        <h2 style="color:#6366f1;">🎨 拼豆图案生成器</h2>
        <p>您的验证码是：</p>
        <div style="font-size:32px;font-weight:bold;color:#6366f1;letter-spacing:8px;
                    background:#f3f4f6;padding:16px;border-radius:8px;text-align:center;">
            {code}
        </div>
        <p style="color:#666;font-size:13px;margin-top:16px;">验证码5分钟内有效，请勿泄露给他人。</p>
    </div>
    """
    sent = _send_email(email, subject, body)
    if not sent:
        return jsonify({'error': '验证码发送失败，请检查邮箱地址或稍后重试'}), 500

    return jsonify({'message': '验证码已发送', 'expires_in': CODE_EXPIRE_SEC})

@app.route('/api/invite/validate')
def validate_invite_code():
    code = _normalize_invite_code(request.args.get('code', ''))
    if not code:
        return jsonify({'error': '请输入邀请码'}), 400

    db = get_db()
    row = db.execute(
        "SELECT email, nickname FROM users WHERE invite_code=?",
        (code,)
    ).fetchone()
    if not row:
        return jsonify({'error': '邀请码无效'}), 404

    return jsonify({
        'valid': True,
        'code': code,
        'inviter_label': _mask_inviter_label(row['email'], row['nickname']),
        'invitee_reward': INVITEE_REGISTER_BONUS,
        'inviter_reward': INVITER_ACTIVATE_BONUS,
        'anti_abuse_note': '同设备或同网络下的异常邀请不计奖励',
    })

# ── Register ──
@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    code = (data.get('code') or '').strip()
    password = data.get('password') or ''
    invite_code = _normalize_invite_code(data.get('invite_code') or '')
    client_ip = _client_ip()
    client_fingerprint = _client_fingerprint()

    if not email or not _validate_email(email):
        return jsonify({'error': '请输入有效的邮箱地址'}), 400
    if not code or len(code) != 6:
        return jsonify({'error': '请输入6位验证码'}), 400
    if len(password) < 6:
        return jsonify({'error': '密码至少6位'}), 400
    if _rate_limited(f'register:{client_ip}', 10, 3600):
        return jsonify({'error': '当前网络注册次数过多，请稍后再试'}), 429
    if client_fingerprint and _rate_limited(f'register-fp:{client_fingerprint}', 6, 3600):
        return jsonify({'error': '当前设备操作过于频繁，请稍后再试'}), 429

    db = get_db()

    inviter = None
    invite_block_reason = ''
    if invite_code:
        inviter = db.execute(
            "SELECT id, email, nickname, register_ip, register_fingerprint FROM users WHERE invite_code=?",
            (invite_code,)
        ).fetchone()
        if not inviter:
            return jsonify({'error': '邀请码无效'}), 400
        invite_block_reason = _invite_block_reason(db, inviter, client_ip, client_fingerprint)

    # Verify code
    row = db.execute("""
        SELECT id, code, created_at FROM verify_codes
        WHERE email=? AND purpose='register' AND used=0
        ORDER BY id DESC LIMIT 1
    """, (email,)).fetchone()

    if not row:
        return jsonify({'error': '请先获取验证码'}), 400

    created = datetime.fromisoformat(row['created_at'])
    if (datetime.now(timezone.utc) - created).total_seconds() > CODE_EXPIRE_SEC:
        return jsonify({'error': '验证码已过期，请重新获取'}), 400
    if not hmac.compare_digest(row['code'], code):
        return jsonify({'error': '验证码错误'}), 400

    # Check if email already registered
    if db.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone():
        return jsonify({'error': '该邮箱已注册'}), 409

    # Create user
    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    now = _now_iso()
    invite_reward_enabled = bool(inviter) and not invite_block_reason
    starting_beans = NEW_USER_BEANS + (INVITEE_REGISTER_BONUS if invite_reward_enabled else 0)
    user_invite_code = _create_unique_invite_code(db)
    cur = db.execute(
        "INSERT INTO users (email, password_hash, beans, created_at, last_login, invite_code, invited_by, register_ip, register_fingerprint) VALUES (?,?,?,?,?,?,?,?,?)",
        (email, pw_hash, starting_beans, now, now, user_invite_code, inviter['id'] if inviter else None, client_ip, client_fingerprint)
    )
    user_id = cur.lastrowid

    # Mark code as used
    db.execute("UPDATE verify_codes SET used=1 WHERE id=?", (row['id'],))

    # Log bean gift
    db.execute("INSERT INTO bean_log (user_id, delta, reason, created_at) VALUES (?,?,?,?)",
               (user_id, NEW_USER_BEANS, '新用户注册赠送', now))
    if invite_reward_enabled:
        db.execute(
            "INSERT INTO bean_log (user_id, delta, reason, created_at) VALUES (?,?,?,?)",
            (user_id, INVITEE_REGISTER_BONUS, '填写邀请码奖励', now)
        )
        db.execute(
            """
            INSERT INTO invite_relations
            (inviter_user_id, invitee_user_id, invite_code, invitee_reward, inviter_reward, status, block_reason, created_at)
            VALUES (?,?,?,?,?,?,?,?)
            """,
            (inviter['id'], user_id, invite_code, INVITEE_REGISTER_BONUS, INVITER_ACTIVATE_BONUS, 'registered', '', now)
        )
    elif inviter:
        db.execute(
            """
            INSERT INTO invite_relations
            (inviter_user_id, invitee_user_id, invite_code, invitee_reward, inviter_reward, status, block_reason, created_at)
            VALUES (?,?,?,?,?,?,?,?)
            """,
            (inviter['id'], user_id, invite_code, 0, 0, 'blocked', _invite_block_reason_text(invite_block_reason), now)
        )
    db.commit()

    token = _create_token(user_id, email)
    return jsonify({
        'message': '注册成功',
        'token': token,
        'register_reward': NEW_USER_BEANS,
        'invitee_reward': INVITEE_REGISTER_BONUS if invite_reward_enabled else 0,
        'invite_requested': bool(inviter),
        'invite_applied': invite_reward_enabled,
        'invite_blocked': bool(invite_block_reason),
        'invite_blocked_reason': _invite_block_reason_text(invite_block_reason) if invite_block_reason else '',
        'user': {'email': email, 'beans': starting_beans, 'is_member': False}
    })

# ── Login (email + password) ──
@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    client_ip = _client_ip()
    client_fingerprint = _client_fingerprint()

    if not email or not password:
        return jsonify({'error': '请输入邮箱和密码'}), 400

    if _rate_limited(f'login:{client_ip}', 10, 3600):
        return jsonify({'error': '登录尝试过多，请稍后再试'}), 429

    db = get_db()
    row = db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if not row:
        return jsonify({'error': '邮箱或密码错误'}), 401

    if not bcrypt.checkpw(password.encode(), row['password_hash'].encode()):
        return jsonify({'error': '邮箱或密码错误'}), 401

    now = _now_iso()
    db.execute("UPDATE users SET last_login=? WHERE id=?", (now, row['id']))
    _backfill_user_identity(db, row['id'], client_ip, client_fingerprint)
    db.commit()

    token = _create_token(row['id'], email)
    return jsonify({
        'message': '登录成功',
        'token': token,
        'user': {
            'email': email,
            'beans': row['beans'],
            'is_member': bool(row['is_member']),
            'member_expire': row['member_expire']
        }
    })

@app.route('/api/image/restore', methods=['POST'])
def restore_image():
    data = request.get_json(silent=True) or {}
    image_data = data.get('image_data') or ''
    bead_width = data.get('bead_width')

    if not image_data:
        return jsonify({'error': '请先导入一张图片'}), 400

    client_ip = request.headers.get('X-Forwarded-For', request.remote_addr)
    if _rate_limited(f'restore:{client_ip}', 30, 3600):
        return jsonify({'error': '还原次数过多，请稍后再试'}), 429

    try:
        source = _decode_image_data_url(image_data)
        restored_small, restored_preview = _restore_pixel_source(source, bead_width)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        app.logger.warning('Image restore failed: %s', e)
        return jsonify({'error': '原图还原失败，请换一张更清晰的拼豆图再试'}), 500

    return jsonify({
        'mode': 'local-smart-restore',
        'grid_width': restored_small.width,
        'grid_height': restored_small.height,
        'image_data': _encode_png_data_url(restored_preview),
    })

# ── Xiaohongshu import ──
@app.route('/api/import/xhs/note', methods=['POST'])
def import_xhs_note():
    data = request.get_json(silent=True) or {}
    raw_text = (data.get('url') or data.get('text') or '').strip()
    if not raw_text:
        return jsonify({'error': '请粘贴小红书帖子链接或分享文案'}), 400

    client_ip = request.headers.get('X-Forwarded-For', request.remote_addr)
    if _rate_limited(f'xhs_note:{client_ip}', 20, 3600):
        return jsonify({'error': '解析次数过多，请稍后再试'}), 429

    try:
        note = _fetch_xhs_note(raw_text)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except requests.RequestException as e:
        app.logger.warning('XHS note fetch failed: %s', e)
        return jsonify({'error': '暂时无法访问小红书帖子，请稍后重试'}), 502

    base_url = request.url_root.rstrip('/')
    note['images'] = [
        {
            'index': index + 1,
            'width': image.get('width', 0),
            'height': image.get('height', 0),
            'proxy_url': f"{base_url}/api/import/xhs/image?url={quote(image['raw_url'], safe='')}",
        }
        for index, image in enumerate(note['images'])
    ]
    note['image_count'] = len(note['images'])
    return jsonify(note)

@app.route('/api/import/xhs/image')
def import_xhs_image():
    image_url = _clean_remote_url(request.args.get('url', ''))
    if not image_url or not _looks_like_xhs_image(image_url):
        return jsonify({'error': '无效的图片地址'}), 400

    client_ip = request.headers.get('X-Forwarded-For', request.remote_addr)
    if _rate_limited(f'xhs_image:{client_ip}', 120, 3600):
        return jsonify({'error': '图片请求过多，请稍后再试'}), 429

    try:
        response = requests.get(image_url, headers=XHS_IMAGE_HEADERS, timeout=HTTP_TIMEOUT)
        response.raise_for_status()
    except requests.RequestException as e:
        app.logger.warning('XHS image proxy failed: %s', e)
        return jsonify({'error': '图片加载失败'}), 502

    content_type = (response.headers.get('Content-Type') or '').split(';', 1)[0].strip().lower()
    if not content_type.startswith('image/'):
        return jsonify({'error': '远端资源不是图片'}), 400

    proxied = send_file(BytesIO(response.content), mimetype=content_type, download_name='xhs-image')
    proxied.headers['Cache-Control'] = 'public, max-age=86400'
    return proxied

# ── Get user info ──
@app.route('/api/user/info')
@auth_required
def user_info():
    db = get_db()
    _backfill_user_identity(db, g.user_id, _client_ip(), _client_fingerprint())
    db.commit()
    row = db.execute("SELECT * FROM users WHERE id=?", (g.user_id,)).fetchone()
    if not row:
        return jsonify({'error': '用户不存在'}), 404
    return jsonify({
        'user': {
            'email': row['email'],
            'nickname': row['nickname'],
            'beans': row['beans'],
            'is_member': bool(row['is_member']),
            'member_expire': row['member_expire']
        }
    })

@app.route('/api/invite/me')
@auth_required
def invite_me():
    db = get_db()
    _backfill_user_identity(db, g.user_id, _client_ip(), _client_fingerprint())
    db.commit()
    user = db.execute(
        "SELECT email, nickname, invite_code FROM users WHERE id=?",
        (g.user_id,)
    ).fetchone()
    if not user:
        return jsonify({'error': '用户不存在'}), 404

    total = db.execute(
        "SELECT COUNT(*) AS c FROM invite_relations WHERE inviter_user_id=?",
        (g.user_id,)
    ).fetchone()['c']
    rewarded = db.execute(
        "SELECT COUNT(*) AS c, COALESCE(SUM(inviter_reward), 0) AS beans FROM invite_relations WHERE inviter_user_id=? AND status='rewarded'",
        (g.user_id,)
    ).fetchone()
    pending = db.execute(
        "SELECT COUNT(*) AS c FROM invite_relations WHERE inviter_user_id=? AND status='registered'",
        (g.user_id,)
    ).fetchone()['c']
    blocked = db.execute(
        "SELECT COUNT(*) AS c FROM invite_relations WHERE inviter_user_id=? AND status='blocked'",
        (g.user_id,)
    ).fetchone()['c']
    recent_rows = db.execute(
        """
        SELECT r.status, r.created_at, r.rewarded_at, r.inviter_reward, r.block_reason,
               u.email AS invitee_email, u.nickname AS invitee_nickname
        FROM invite_relations r
        LEFT JOIN users u ON u.id = r.invitee_user_id
        WHERE r.inviter_user_id=?
        ORDER BY r.id DESC
        LIMIT 10
        """,
        (g.user_id,)
    ).fetchall()

    return jsonify({
        'invite_code': user['invite_code'],
        'invite_link': _invite_link(user['invite_code']),
        'invitee_reward': INVITEE_REGISTER_BONUS,
        'inviter_reward': INVITER_ACTIVATE_BONUS,
        'stats': {
            'total_invites': total,
            'rewarded_invites': rewarded['c'],
            'pending_invites': pending,
            'blocked_invites': blocked,
            'rewarded_beans': rewarded['beans'],
            'pending_reward_beans': pending * INVITER_ACTIVATE_BONUS,
        },
        'recent': [
            {
                'status': row['status'],
                'invitee_label': _mask_inviter_label(row['invitee_email'] or '', row['invitee_nickname'] or ''),
                'created_at': row['created_at'],
                'rewarded_at': row['rewarded_at'],
                'inviter_reward': row['inviter_reward'],
                'block_reason': row['block_reason'] or '',
            }
            for row in recent_rows
        ],
        'share_message': (
            f"我在 {SITE_URL} 做拼豆图案，注册时填写邀请码 {user['invite_code']}，"
            f"你可额外获得 {INVITEE_REGISTER_BONUS} 豆，我会在你首次生成图案后获得 {INVITER_ACTIVATE_BONUS} 豆。"
        ),
        'rules': [
            f'好友注册并填写邀请码：对方 +{INVITEE_REGISTER_BONUS} 豆',
            f'好友首次生成图案：你 +{INVITER_ACTIVATE_BONUS} 豆',
            '同设备或同网络下的异常邀请不计奖励',
            f'同一网络 {INVITE_IP_WINDOW_HOURS} 小时内最多 {INVITE_IP_REWARD_LIMIT} 个邀请奖励名额',
        ],
    })

# ── Consume beans ──
@app.route('/api/beans/consume', methods=['POST'])
@auth_required
def consume_beans():
    data = request.get_json(silent=True) or {}
    count = data.get('count', 1)
    reason = data.get('reason', '生成拼豆图案')

    if count < 1:
        return jsonify({'error': '无效的消耗数量'}), 400

    db = get_db()
    row = db.execute("SELECT beans FROM users WHERE id=?", (g.user_id,)).fetchone()
    if not row or row['beans'] < count:
        return jsonify({'error': '豆子不足', 'beans': row['beans'] if row else 0, 'need_recharge': True}), 403

    now = _now_iso()
    db.execute("UPDATE users SET beans = beans - ? WHERE id=?", (count, g.user_id))
    db.execute("INSERT INTO bean_log (user_id, delta, reason, created_at) VALUES (?,?,?,?)",
               (g.user_id, -count, reason, now))
    invite_rewarded = 0
    if reason == '生成拼豆图案':
        invite_rewarded = _activate_invite_reward(db, g.user_id, now)
    db.commit()

    new_row = db.execute("SELECT beans FROM users WHERE id=?", (g.user_id,)).fetchone()
    return jsonify({'message': 'ok', 'beans': new_row['beans'], 'invite_rewarded': invite_rewarded})

# ── Daily check-in ──
@app.route('/api/beans/checkin', methods=['POST'])
@auth_required
def daily_checkin():
    db = get_db()
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    already = db.execute(
        "SELECT id FROM bean_log WHERE user_id=? AND reason='每日签到' AND created_at >= ?",
        (g.user_id, today)
    ).fetchone()
    if already:
        return jsonify({'error': '今天已经签到过了', 'checked_in': True}), 400

    now = _now_iso()
    db.execute("UPDATE users SET beans = beans + ? WHERE id=?", (DAILY_CHECKIN_BEANS, g.user_id))
    db.execute("INSERT INTO bean_log (user_id, delta, reason, created_at) VALUES (?,?,?,?)",
               (g.user_id, DAILY_CHECKIN_BEANS, '每日签到', now))
    db.commit()

    row = db.execute("SELECT beans FROM users WHERE id=?", (g.user_id,)).fetchone()
    return jsonify({'message': '签到成功', 'beans': row['beans'], 'reward': DAILY_CHECKIN_BEANS})

# ── Bean balance ──
@app.route('/api/beans/balance')
@auth_required
def bean_balance():
    db = get_db()
    row = db.execute("SELECT beans FROM users WHERE id=?", (g.user_id,)).fetchone()
    return jsonify({'beans': row['beans'] if row else 0})

# ── Bean logs ──
@app.route('/api/beans/log')
@auth_required
def bean_log():
    db = get_db()
    rows = db.execute(
        "SELECT delta, reason, created_at FROM bean_log WHERE user_id=? ORDER BY id DESC LIMIT 50",
        (g.user_id,)
    ).fetchall()
    return jsonify({'logs': [dict(r) for r in rows]})

# ── Admin ──
def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        key = request.headers.get('X-Admin-Key', '')
        if not hmac.compare_digest(key, ADMIN_KEY):
            return jsonify({'error': '无权访问'}), 403
        return f(*args, **kwargs)
    return decorated

@app.route('/api/admin/stats')
@admin_required
def admin_stats():
    db = get_db()
    total = db.execute("SELECT COUNT(*) as c FROM users").fetchone()['c']
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    today_new = db.execute("SELECT COUNT(*) as c FROM users WHERE created_at >= ?", (today,)).fetchone()['c']
    today_active = db.execute("SELECT COUNT(*) as c FROM users WHERE last_login >= ?", (today,)).fetchone()['c']
    total_beans_used = db.execute("SELECT COALESCE(SUM(ABS(delta)),0) as c FROM bean_log WHERE delta < 0").fetchone()['c']
    total_revenue = db.execute("SELECT COALESCE(SUM(CAST(amount AS REAL)),0) as c FROM orders WHERE status='paid'").fetchone()['c']
    return jsonify({'total_users': total, 'today_new': today_new, 'today_active': today_active, 'total_beans_used': total_beans_used, 'total_revenue': round(total_revenue, 2)})

@app.route('/api/admin/users')
@admin_required
def admin_users():
    db = get_db()
    page = max(1, request.args.get('page', 1, type=int))
    per = min(100, request.args.get('per', 50, type=int))
    search = request.args.get('q', '').strip()
    offset = (page - 1) * per
    if search:
        like = f'%{search}%'
        rows = db.execute(
            "SELECT id, email, nickname, beans, is_member, member_expire, created_at, last_login FROM users WHERE email LIKE ? ORDER BY id DESC LIMIT ? OFFSET ?",
            (like, per, offset)
        ).fetchall()
        total = db.execute("SELECT COUNT(*) as c FROM users WHERE email LIKE ?", (like,)).fetchone()['c']
    else:
        rows = db.execute(
            "SELECT id, email, nickname, beans, is_member, member_expire, created_at, last_login FROM users ORDER BY id DESC LIMIT ? OFFSET ?",
            (per, offset)
        ).fetchall()
        total = db.execute("SELECT COUNT(*) as c FROM users").fetchone()['c']
    return jsonify({'users': [dict(r) for r in rows], 'total': total, 'page': page, 'per': per})

@app.route('/api/admin/beans-log')
@admin_required
def admin_beans_log():
    db = get_db()
    page = max(1, request.args.get('page', 1, type=int))
    per = min(100, request.args.get('per', 50, type=int))
    offset = (page - 1) * per
    rows = db.execute("""
        SELECT b.id, b.user_id, u.email, b.delta, b.reason, b.created_at
        FROM bean_log b LEFT JOIN users u ON b.user_id = u.id
        ORDER BY b.id DESC LIMIT ? OFFSET ?
    """, (per, offset)).fetchall()
    total = db.execute("SELECT COUNT(*) as c FROM bean_log").fetchone()['c']
    return jsonify({'logs': [dict(r) for r in rows], 'total': total, 'page': page})

@app.route('/api/admin/user/<int:uid>/beans', methods=['POST'])
@admin_required
def admin_adjust_beans(uid):
    data = request.get_json(silent=True) or {}
    delta = data.get('delta', 0)
    reason = data.get('reason', '管理员调整')
    if not isinstance(delta, int) or delta == 0:
        return jsonify({'error': '请输入有效的调整数量'}), 400
    db = get_db()
    row = db.execute("SELECT beans FROM users WHERE id=?", (uid,)).fetchone()
    if not row:
        return jsonify({'error': '用户不存在'}), 404
    new_beans = max(0, row['beans'] + delta)
    now = _now_iso()
    db.execute("UPDATE users SET beans=? WHERE id=?", (new_beans, uid))
    db.execute("INSERT INTO bean_log (user_id, delta, reason, created_at) VALUES (?,?,?,?)",
               (uid, delta, reason, now))
    db.commit()
    return jsonify({'message': 'ok', 'beans': new_beans})

# ── Payment: 个人收款码 + 管理员确认 ──

def _gen_order_no():
    ts = datetime.now().strftime('%Y%m%d%H%M%S')
    return f'PD{ts}{random.randint(1000, 9999)}'

def _fulfill_order(db, order):
    """Fulfill a paid order: add beans, update member status."""
    now = _now_iso()
    user_id = order['user_id']
    beans = order['beans']
    db.execute("UPDATE users SET beans = beans + ? WHERE id=?", (beans, user_id))
    db.execute("INSERT INTO bean_log (user_id, delta, reason, created_at) VALUES (?,?,?,?)",
               (user_id, beans, f"充值 {order['package_name']}", now))

    member_days = order['member_days']
    if member_days > 0:
        user = db.execute("SELECT member_expire FROM users WHERE id=?", (user_id,)).fetchone()
        current_expire = user['member_expire'] if user and user['member_expire'] else ''
        try:
            base_date = datetime.fromisoformat(current_expire)
            if base_date < datetime.now(timezone.utc):
                base_date = datetime.now(timezone.utc)
        except (ValueError, TypeError):
            base_date = datetime.now(timezone.utc)
        new_expire = (base_date + timedelta(days=member_days)).strftime('%Y-%m-%d')
        db.execute("UPDATE users SET is_member=1, member_expire=? WHERE id=?", (new_expire, user_id))

    db.execute("UPDATE orders SET status='paid', pay_time=? WHERE id=?", (now, order['id']))
    db.commit()
    app.logger.info("Order %s fulfilled, +%d beans for user %d", order['order_no'], beans, user_id)

@app.route('/api/pay/packages')
def pay_packages():
    """Return available recharge packages + payment QR codes."""
    pkgs = []
    for pid, info in RECHARGE_PACKAGES.items():
        pkgs.append({
            'id': pid,
            'name': info['name'],
            'beans': info['beans'],
            'price': info['price'],
            'type': info['type'],
            'days': info.get('days', 0),
        })
    return jsonify({
        'packages': pkgs,
        'qrcode_wechat': PAY_QRCODE_WECHAT,
        'qrcode_alipay': PAY_QRCODE_ALIPAY,
    })

@app.route('/api/pay/create', methods=['POST'])
@auth_required
def pay_create():
    """Create a pending order (user will pay via personal QR code)."""
    data = request.get_json(silent=True) or {}
    package_id = data.get('package_id', '')

    if package_id not in RECHARGE_PACKAGES:
        return jsonify({'error': '无效的套餐'}), 400

    pkg = RECHARGE_PACKAGES[package_id]
    order_no = _gen_order_no()
    now = _now_iso()

    db = get_db()
    db.execute(
        """INSERT INTO orders (order_no, user_id, package_id, package_name, amount, beans, member_days, status, created_at)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (order_no, g.user_id, package_id, pkg['name'], pkg['price'], pkg['beans'],
         pkg.get('days', 0), 'pending', now)
    )
    db.commit()

    return jsonify({
        'order_no': order_no,
        'amount': pkg['price'],
        'package_name': pkg['name'],
        'qrcode_wechat': PAY_QRCODE_WECHAT,
        'qrcode_alipay': PAY_QRCODE_ALIPAY,
    })

@app.route('/api/pay/status')
@auth_required
def pay_status():
    """Check order payment status."""
    order_no = request.args.get('order_no', '')
    if not order_no:
        return jsonify({'error': '缺少订单号'}), 400
    db = get_db()
    order = db.execute("SELECT status, beans, package_name FROM orders WHERE order_no=? AND user_id=?",
                       (order_no, g.user_id)).fetchone()
    if not order:
        return jsonify({'error': '订单不存在'}), 404
    # Also return current beans
    user = db.execute("SELECT beans FROM users WHERE id=?", (g.user_id,)).fetchone()
    return jsonify({'status': order['status'], 'beans': user['beans'] if user else 0})

@app.route('/api/pay/orders')
@auth_required
def pay_orders():
    """User's order history."""
    db = get_db()
    rows = db.execute(
        "SELECT order_no, package_name, amount, beans, status, created_at, pay_time FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 50",
        (g.user_id,)
    ).fetchall()
    return jsonify({'orders': [dict(r) for r in rows]})

@app.route('/api/admin/orders')
@admin_required
def admin_orders():
    """Admin: list all orders."""
    db = get_db()
    page = max(1, request.args.get('page', 1, type=int))
    per = min(100, request.args.get('per', 50, type=int))
    status = request.args.get('status', '').strip()
    offset = (page - 1) * per
    if status:
        rows = db.execute(
            """SELECT o.*, u.email FROM orders o LEFT JOIN users u ON o.user_id = u.id
               WHERE o.status=? ORDER BY o.id DESC LIMIT ? OFFSET ?""",
            (status, per, offset)
        ).fetchall()
        total = db.execute("SELECT COUNT(*) as c FROM orders WHERE status=?", (status,)).fetchone()['c']
    else:
        rows = db.execute(
            """SELECT o.*, u.email FROM orders o LEFT JOIN users u ON o.user_id = u.id
               ORDER BY o.id DESC LIMIT ? OFFSET ?""",
            (per, offset)
        ).fetchall()
        total = db.execute("SELECT COUNT(*) as c FROM orders").fetchone()['c']
    return jsonify({'orders': [dict(r) for r in rows], 'total': total, 'page': page})

@app.route('/api/admin/order/<int:order_id>/confirm', methods=['POST'])
@admin_required
def admin_confirm_order(order_id):
    """Admin: confirm payment for an order."""
    db = get_db()
    order = db.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
    if not order:
        return jsonify({'error': '订单不存在'}), 404
    if order['status'] == 'paid':
        return jsonify({'error': '该订单已确认'}), 400
    _fulfill_order(db, order)
    return jsonify({'message': '已确认到账', 'order_no': order['order_no']})

@app.route('/api/admin/order/<int:order_id>/cancel', methods=['POST'])
@admin_required
def admin_cancel_order(order_id):
    """Admin: cancel an order."""
    db = get_db()
    order = db.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
    if not order:
        return jsonify({'error': '订单不存在'}), 404
    if order['status'] == 'paid':
        return jsonify({'error': '已支付的订单无法取消'}), 400
    db.execute("UPDATE orders SET status='cancelled' WHERE id=?", (order_id,))
    db.commit()
    return jsonify({'message': '订单已取消'})

# ── Feature click tracking (public, rate-limited) ──
_click_rate = {}  # ip -> (count, window_start)

@app.route('/api/track/click', methods=['POST'])
def track_click():
    """Record a feature click event."""
    ip = request.headers.get('X-Forwarded-For', request.remote_addr or '').split(',')[0].strip()
    now = time.time()
    # Simple rate limit: max 60 clicks per minute per IP
    bucket = _click_rate.get(ip)
    if bucket and now - bucket[1] < 60:
        if bucket[0] >= 60:
            return jsonify({'ok': True})  # silently drop
        _click_rate[ip] = (bucket[0] + 1, bucket[1])
    else:
        _click_rate[ip] = (1, now)

    data = request.get_json(silent=True) or {}
    feature = str(data.get('feature', '')).strip()[:100]
    page = str(data.get('page', '')).strip()[:100]
    if not feature:
        return jsonify({'error': '缺少 feature'}), 400

    user_id = 0
    auth = request.headers.get('Authorization', '')
    if auth.startswith('Bearer '):
        try:
            payload = jwt.decode(auth[7:], SECRET_KEY, algorithms=['HS256'])
            user_id = payload.get('uid', 0)
        except Exception:
            pass

    db = get_db()
    db.execute(
        "INSERT INTO feature_clicks (feature, page, user_id, ip, created_at) VALUES (?, ?, ?, ?, ?)",
        (feature, page, user_id, ip, datetime.now(timezone.utc).isoformat())
    )
    db.commit()
    return jsonify({'ok': True})


@app.route('/api/admin/user-growth')
@admin_required
def admin_user_growth():
    """Return daily new user counts for the past N days."""
    days = min(365, max(7, request.args.get('days', 30, type=int)))
    db = get_db()
    rows = db.execute(
        "SELECT DATE(created_at) as day, COUNT(*) as cnt "
        "FROM users WHERE created_at >= DATE('now', ?) "
        "GROUP BY DATE(created_at) ORDER BY day",
        (f'-{days} days',)
    ).fetchall()
    daily = {r['day']: r['cnt'] for r in rows}

    # Fill missing days with 0
    result = []
    for i in range(days, -1, -1):
        d = (datetime.now(timezone.utc) - timedelta(days=i)).strftime('%Y-%m-%d')
        result.append({'day': d, 'count': daily.get(d, 0)})

    # Weekly / Monthly / Yearly aggregates
    weekly = db.execute(
        "SELECT strftime('%%Y-W%%W', created_at) as week, COUNT(*) as cnt "
        "FROM users WHERE created_at >= DATE('now', '-12 weeks') "
        "GROUP BY week ORDER BY week"
    ).fetchall()
    monthly = db.execute(
        "SELECT strftime('%%Y-%%m', created_at) as month, COUNT(*) as cnt "
        "FROM users WHERE created_at >= DATE('now', '-12 months') "
        "GROUP BY month ORDER BY month"
    ).fetchall()
    yearly = db.execute(
        "SELECT strftime('%%Y', created_at) as year, COUNT(*) as cnt "
        "FROM users GROUP BY year ORDER BY year"
    ).fetchall()

    return jsonify({
        'daily': result,
        'weekly': [dict(r) for r in weekly],
        'monthly': [dict(r) for r in monthly],
        'yearly': [dict(r) for r in yearly]
    })


@app.route('/api/admin/feature-stats')
@admin_required
def admin_feature_stats():
    """Return feature click statistics."""
    days = min(365, max(1, request.args.get('days', 7, type=int)))
    db = get_db()

    # Top features
    top_features = db.execute(
        "SELECT feature, COUNT(*) as cnt, COUNT(DISTINCT ip) as uv "
        "FROM feature_clicks WHERE created_at >= DATE('now', ?) "
        "GROUP BY feature ORDER BY cnt DESC LIMIT 50",
        (f'-{days} days',)
    ).fetchall()

    # Top features by page
    by_page = db.execute(
        "SELECT page, feature, COUNT(*) as cnt "
        "FROM feature_clicks WHERE created_at >= DATE('now', ?) "
        "GROUP BY page, feature ORDER BY cnt DESC LIMIT 100",
        (f'-{days} days',)
    ).fetchall()

    # Daily trend for top 5 features
    top5 = [r['feature'] for r in top_features[:5]]
    daily_trend = []
    if top5:
        placeholders = ','.join('?' * len(top5))
        daily_trend = db.execute(
            f"SELECT DATE(created_at) as day, feature, COUNT(*) as cnt "
            f"FROM feature_clicks WHERE created_at >= DATE('now', ?) AND feature IN ({placeholders}) "
            f"GROUP BY day, feature ORDER BY day",
            (f'-{days} days', *top5)
        ).fetchall()

    return jsonify({
        'top_features': [dict(r) for r in top_features],
        'by_page': [dict(r) for r in by_page],
        'daily_trend': [dict(r) for r in daily_trend]
    })


# ── Main ──
if __name__ == '__main__':
    init_db()
    port = int(os.environ.get('PORT', '8081'))
    app.run(host='0.0.0.0', port=port, debug=False)
