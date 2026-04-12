/* ═══════════ Auth & Bean System ═══════════ */

const API_BASE = (() => {
  const override = localStorage.getItem('pindou_api_base');
  if (override) return override.replace(/\/$/, '');

  const { protocol, hostname } = window.location;
  if (protocol === 'file:' || hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://127.0.0.1:8081';
  }

  return 'https://api.pindou.top';
})();

const INVITE_STORAGE_KEY = 'pindou_invite_code';
const CLIENT_FINGERPRINT_STORAGE_KEY = 'pindou_client_fingerprint';

function normalizeClientFingerprint(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64);
}

function generateClientFingerprint() {
  const prefix = Date.now().toString(36);
  if (window.crypto && window.crypto.getRandomValues) {
    const bytes = new Uint8Array(12);
    window.crypto.getRandomValues(bytes);
    const randomPart = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return normalizeClientFingerprint(`${prefix}${randomPart}`);
  }
  return normalizeClientFingerprint(`${prefix}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`);
}

function getClientFingerprint() {
  const stored = normalizeClientFingerprint(localStorage.getItem(CLIENT_FINGERPRINT_STORAGE_KEY));
  if (stored && stored.length >= 16) return stored;
  const created = generateClientFingerprint();
  localStorage.setItem(CLIENT_FINGERPRINT_STORAGE_KEY, created);
  return created;
}

function normalizeInviteCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

function readInviteCodeFromUrl() {
  try {
    return normalizeInviteCode(new URLSearchParams(window.location.search).get('invite') || '');
  } catch (e) {
    return '';
  }
}

class AuthManager {
  constructor() {
    this.token = localStorage.getItem('pindou_token') || '';
    this.user = JSON.parse(localStorage.getItem('pindou_user') || 'null');
    const urlInviteCode = readInviteCodeFromUrl();
    this.pendingInviteCode = urlInviteCode || normalizeInviteCode(localStorage.getItem(INVITE_STORAGE_KEY) || '');
    this.landedWithInvite = !!urlInviteCode;
    this.firstGenDone = !!localStorage.getItem('pindou_first_gen');
    this._patternTimer = null;
    this._timerTriggered = false;
    if (urlInviteCode) this.setPendingInviteCode(urlInviteCode);
  }

  get isLoggedIn() { return !!this.token && !!this.user; }
  get beans() { return this.user ? this.user.beans : 0; }

  _save() {
    if (this.token) localStorage.setItem('pindou_token', this.token);
    else localStorage.removeItem('pindou_token');
    if (this.user) localStorage.setItem('pindou_user', JSON.stringify(this.user));
    else localStorage.removeItem('pindou_user');
  }

  _headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    h['X-Client-Fingerprint'] = getClientFingerprint();
    return h;
  }

  setPendingInviteCode(code) {
    this.pendingInviteCode = normalizeInviteCode(code);
    if (this.pendingInviteCode) localStorage.setItem(INVITE_STORAGE_KEY, this.pendingInviteCode);
    else localStorage.removeItem(INVITE_STORAGE_KEY);
  }

  async sendCode(email, purpose = 'register') {
    const r = await fetch(`${API_BASE}/api/auth/send-code`, {
      method: 'POST', headers: this._headers(),
      body: JSON.stringify({ email, purpose })
    });
    return r.json();
  }

  async register(email, code, password, inviteCode = '') {
    const r = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST', headers: this._headers(),
      body: JSON.stringify({ email, code, password, invite_code: normalizeInviteCode(inviteCode) })
    });
    const d = await r.json();
    if (d.token) {
      this.token = d.token;
      this.user = d.user;
      this._save();
    }
    return d;
  }

  async validateInviteCode(code) {
    const normalized = normalizeInviteCode(code);
    if (!normalized) return { error: '请输入邀请码' };
    const r = await fetch(`${API_BASE}/api/invite/validate?code=${encodeURIComponent(normalized)}`);
    return r.json();
  }

  async getInviteInfo() {
    const r = await fetch(`${API_BASE}/api/invite/me`, { headers: this._headers() });
    const d = await r.json();
    if (r.status === 401) this.logout();
    return d;
  }

  async login(email, password) {
    const r = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST', headers: this._headers(),
      body: JSON.stringify({ email, password })
    });
    const d = await r.json();
    if (d.token) {
      this.token = d.token;
      this.user = d.user;
      this._save();
    }
    return d;
  }

  async refreshUser() {
    if (!this.token) return;
    try {
      const r = await fetch(`${API_BASE}/api/user/info`, { headers: this._headers() });
      if (r.ok) {
        const d = await r.json();
        this.user = d.user;
        this._save();
      } else if (r.status === 401) {
        this.logout();
      }
    } catch (e) { /* network error, keep cached data */ }
  }

  async consumeBean(reason = '生成拼豆图案') {
    const r = await fetch(`${API_BASE}/api/beans/consume`, {
      method: 'POST', headers: this._headers(),
      body: JSON.stringify({ count: 1, reason })
    });
    const d = await r.json();
    if (d.beans !== undefined && this.user) {
      this.user.beans = d.beans;
      this._save();
    }
    return d;
  }

  logout() {
    this.token = '';
    this.user = null;
    localStorage.removeItem('pindou_token');
    localStorage.removeItem('pindou_user');
  }

  markFirstGen() {
    this.firstGenDone = true;
    localStorage.setItem('pindou_first_gen', '1');
  }

  // Start 1-minute timer when pattern is shown
  startPatternTimer(callback) {
    this.stopPatternTimer();
    this._timerTriggered = false;
    this._patternTimer = setTimeout(() => {
      this._timerTriggered = true;
      if (!this.isLoggedIn) callback();
    }, 60000);
  }

  stopPatternTimer() {
    if (this._patternTimer) {
      clearTimeout(this._patternTimer);
      this._patternTimer = null;
    }
  }

  // Check if action requires login
  needsLogin(action) {
    if (this.isLoggedIn) return false;
    if (action === 'download' || action === 'pdf') return true;
    return false;
  }

  // Check if user has enough beans (logged in user)
  needsBeans() {
    return this.isLoggedIn && this.beans <= 0;
  }

  // ── Payment methods ──
  async getPackages() {
    const r = await fetch(`${API_BASE}/api/pay/packages`);
    return r.json();
  }

  async createOrder(packageId) {
    const r = await fetch(`${API_BASE}/api/pay/create`, {
      method: 'POST', headers: this._headers(),
      body: JSON.stringify({ package_id: packageId })
    });
    return r.json();
  }

  async checkOrderStatus(orderNo) {
    const r = await fetch(`${API_BASE}/api/pay/status?order_no=${encodeURIComponent(orderNo)}`, {
      headers: this._headers()
    });
    return r.json();
  }

  async getOrders() {
    const r = await fetch(`${API_BASE}/api/pay/orders`, { headers: this._headers() });
    return r.json();
  }
}

// ── Helpers ──
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast' + (type === 'error' ? ' toast-error' : '');
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); }, 2500);
}

async function copyText(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* fall through */ }

  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', 'readonly');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(input);
  return copied;
}

function formatInviteTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).replace('T', ' ').slice(0, 16);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function setFieldError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg || '';
  const input = el.previousElementSibling;
  if (input && input.tagName === 'DIV') {
    // pw-input-wrap case
    const inp = input.querySelector('input');
    if (inp) { inp.classList.toggle('input-error', !!msg); inp.classList.toggle('input-ok', !msg && inp.value.length > 0); }
  } else if (input && input.tagName === 'INPUT') {
    input.classList.toggle('input-error', !!msg);
    input.classList.toggle('input-ok', !msg && input.value.length > 0);
  }
}

function clearFieldError(id) { setFieldError(id, ''); }

function setSubmitLoading(btn, loading, label) {
  const textEl = btn.querySelector('.btn-text-label');
  const spinEl = btn.querySelector('.btn-spinner');
  if (loading) {
    btn.disabled = true;
    if (textEl) textEl.textContent = label || '';
    if (spinEl) spinEl.classList.remove('hidden');
  } else {
    btn.disabled = false;
    if (textEl) textEl.textContent = label || '';
    if (spinEl) spinEl.classList.add('hidden');
  }
}

const _emailRe = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

// ── Auth UI ──
function initAuthUI(authManager) {
  const $ = id => document.getElementById(id);
  let inviteValidationToken = 0;
  let invitePayload = null;

  function setInviteHint(message, state = '') {
    const hint = $('regInviteHint');
    if (!hint) return;
    hint.textContent = message || '';
    hint.classList.toggle('is-valid', state === 'valid');
    hint.classList.toggle('is-error', state === 'error');
  }

  async function validateInviteInput(rawValue) {
    const inviteCode = normalizeInviteCode(rawValue);
    authManager.setPendingInviteCode(inviteCode);
    const regInvite = $('regInvite');
    if (regInvite && regInvite.value !== inviteCode) regInvite.value = inviteCode;
    clearFieldError('regInviteError');

    if (!inviteCode) {
      setInviteHint('填写邀请码可额外获得 2 个豆子；同设备或同网络邀请不计奖励');
      return null;
    }

    const requestId = ++inviteValidationToken;
    setInviteHint('正在验证邀请码…');
    const res = await authManager.validateInviteCode(inviteCode);
    if (requestId !== inviteValidationToken) return null;

    if (res.valid) {
      const note = res.anti_abuse_note ? `；${res.anti_abuse_note}` : '';
      setInviteHint(`来自 ${res.inviter_label} 的邀请，注册可额外获得 ${res.invitee_reward} 豆${note}`, 'valid');
      return res;
    }

    setFieldError('regInviteError', res.error || '邀请码无效');
    setInviteHint('请输入有效的邀请码', 'error');
    return null;
  }

  function renderInviteInfo(data) {
    invitePayload = data || null;
    const stats = data?.stats || {};
    const recent = Array.isArray(data?.recent) ? data.recent : [];
    const codeEl = $('inviteCodeValue');
    const linkEl = $('inviteLinkInput');
    const totalEl = $('inviteTotalCount');
    const rewardedEl = $('inviteRewardedCount');
    const pendingEl = $('invitePendingCount');
    const blockedEl = $('inviteBlockedCount');
    const beansEl = $('inviteRewardedBeans');
    const recentEl = $('inviteRecentList');
    const sharePreviewEl = $('inviteSharePreview');
    const rulesEl = $('inviteRulesList');

    if (codeEl) codeEl.textContent = data?.invite_code || '-';
    if (linkEl) linkEl.value = data?.invite_link || '';
    if (totalEl) totalEl.textContent = String(stats.total_invites || 0);
    if (rewardedEl) rewardedEl.textContent = String(stats.rewarded_invites || 0);
    if (pendingEl) pendingEl.textContent = String(stats.pending_invites || 0);
    if (blockedEl) blockedEl.textContent = String(stats.blocked_invites || 0);
    if (beansEl) beansEl.textContent = String(stats.rewarded_beans || 0);
    if (sharePreviewEl) sharePreviewEl.textContent = data?.share_message || '';
    if (rulesEl) {
      const rules = Array.isArray(data?.rules) ? data.rules : [];
      rulesEl.innerHTML = rules.map(rule => `<li>${rule}</li>`).join('');
    }

    if (!recentEl) return;
    if (!recent.length) {
      recentEl.innerHTML = '<div class="invite-empty">还没有邀请记录，把邀请码发给朋友试试。</div>';
      return;
    }

    recentEl.innerHTML = recent.map(item => `
      <div class="invite-recent-item">
        <div class="invite-recent-main">
          <div class="invite-recent-name">${item.invitee_label || '拼豆好友'}</div>
          <div class="invite-recent-time">注册于 ${formatInviteTime(item.created_at)}</div>
        </div>
        <span class="invite-status-badge ${item.status === 'rewarded' ? 'is-rewarded' : item.status === 'blocked' ? 'is-blocked' : 'is-pending'}">${item.status === 'rewarded' ? `+${item.inviter_reward} 豆已到账` : item.status === 'blocked' ? (item.block_reason || '未计奖励') : '待首次生成'}</span>
      </div>
    `).join('');
  }

  function showNoBeansModal(beans = authManager.beans) {
    const modal = $('noBeansModal');
    if (!modal) return;
    const countEl = $('beansCount');
    if (countEl) countEl.textContent = String(Number.isFinite(Number(beans)) ? Number(beans) : 0);
    modal.classList.remove('hidden');
  }

  async function showInviteModal() {
    if (!authManager.isLoggedIn) {
      showAuthModal('登录后即可查看邀请码并邀请好友');
      return;
    }

    const modal = $('inviteModal');
    const loading = $('inviteLoading');
    const body = $('inviteBody');
    if (!modal) return;

    modal.classList.remove('hidden');
    if (loading) {
      loading.textContent = '加载中…';
      loading.classList.remove('hidden');
    }
    if (body) body.classList.add('hidden');

    const res = await authManager.getInviteInfo();
    if (res.error) {
      if (loading) loading.textContent = res.error;
      showToast(res.error, 'error');
      return;
    }

    renderInviteInfo(res);
    if (loading) loading.classList.add('hidden');
    if (body) body.classList.remove('hidden');
  }

  function hideInviteModal() {
    $('inviteModal')?.classList.add('hidden');
  }

  // Update header user area
  function updateUserUI() {
    const area = $('userArea');
    if (!area) return;
    if (authManager.isLoggedIn) {
      area.innerHTML = `
        <button class="user-invite-btn" id="inviteTrigger" title="邀请好友注册赚豆">邀请赚豆</button>
        <span class="user-beans" title="豆子余额">🫘 ${authManager.beans}</span>
        <button class="user-recharge-btn" id="rechargeBtn" title="充值豆子">充值</button>
        <span class="user-email">${authManager.user.email.split('@')[0]}</span>
        <button class="btn-text" id="logoutBtn">退出</button>
      `;
      const inviteBtn = $('inviteTrigger');
      if (inviteBtn) inviteBtn.onclick = () => showInviteModal();
      const logoutBtn = $('logoutBtn');
      if (logoutBtn) logoutBtn.onclick = () => { authManager.logout(); updateUserUI(); showToast('已退出登录'); };
      const rechargeBtn = $('rechargeBtn');
      if (rechargeBtn) rechargeBtn.onclick = () => showRechargeModal();
    } else {
      area.innerHTML = `<button class="btn btn-sm btn-outline" id="loginTrigger">登录 / 注册</button>`;
      const trigger = $('loginTrigger');
      if (trigger) trigger.onclick = () => showAuthModal();
    }
  }

  let _modalForced = false;

  // Show auth modal
  function showAuthModal(message, forced) {
    const modal = $('authModal');
    if (!modal) return;
    _modalForced = !!forced;
    // Clear all fields and errors
    modal.querySelectorAll('input').forEach(i => { i.value = ''; i.classList.remove('input-error', 'input-ok'); });
    modal.querySelectorAll('.field-error').forEach(e => e.textContent = '');
    modal.classList.remove('hidden');
    // Hide close button when forced
    const closeBtn = $('authModalClose');
    if (closeBtn) closeBtn.style.display = _modalForced ? 'none' : '';
    const tip = modal.querySelector('.auth-tip');
    if (tip) tip.textContent = message || tip.dataset.defaultTip || '注册后即可获得 10 个免费豆子';
    switchTab('register');

    const inviteCode = authManager.pendingInviteCode;
    const regInvite = $('regInvite');
    if (regInvite) regInvite.value = inviteCode;
    if (inviteCode) validateInviteInput(inviteCode);
    else setInviteHint('填写邀请码可额外获得 2 个豆子；同设备或同网络邀请不计奖励');
  }

  function hideAuthModal() {
    if (_modalForced) return;
    const modal = $('authModal');
    if (modal) modal.classList.add('hidden');
  }

  function switchTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    $('registerForm').classList.toggle('hidden', tab !== 'register');
    $('loginForm').classList.toggle('hidden', tab !== 'login');
  }

  // Bind modal events
  const authModal = $('authModal');
  if (!authModal) return { updateUserUI, showAuthModal, hideAuthModal };

  // Tab switching
  authModal.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Close
  const closeBtn = $('authModalClose');
  if (closeBtn) closeBtn.onclick = hideAuthModal;
  authModal.addEventListener('click', e => { if (e.target === authModal) hideAuthModal(); });

  // Password toggle
  authModal.querySelectorAll('.pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = $(btn.dataset.target);
      if (!target) return;
      const show = target.type === 'password';
      target.type = show ? 'text' : 'password';
      btn.textContent = show ? '🙈' : '👁';
      btn.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
    });
  });

  // ── Real-time validation ──
  const regEmail = $('regEmail');
  const regCode = $('regCode');
  const regPw = $('regPassword');
  const regPwConfirm = $('regPasswordConfirm');
  const regInvite = $('regInvite');
  const loginEmail = $('loginEmail');
  const loginPw = $('loginPassword');

  if (regEmail) regEmail.addEventListener('blur', () => {
    const v = regEmail.value.trim();
    if (v && !_emailRe.test(v)) setFieldError('regEmailError', '请输入有效的邮箱地址');
    else clearFieldError('regEmailError');
  });
  if (regPw) regPw.addEventListener('input', () => {
    if (regPw.value && regPw.value.length < 6) setFieldError('regPasswordError', '密码至少6位');
    else clearFieldError('regPasswordError');
    if (regPwConfirm && regPwConfirm.value) {
      if (regPwConfirm.value !== regPw.value) setFieldError('regPasswordConfirmError', '两次密码不一致');
      else clearFieldError('regPasswordConfirmError');
    }
  });
  if (regPwConfirm) regPwConfirm.addEventListener('input', () => {
    if (regPwConfirm.value && regPw && regPwConfirm.value !== regPw.value) setFieldError('regPasswordConfirmError', '两次密码不一致');
    else clearFieldError('regPasswordConfirmError');
  });
  if (regInvite) regInvite.addEventListener('input', () => {
    const inviteCode = normalizeInviteCode(regInvite.value);
    if (regInvite.value !== inviteCode) regInvite.value = inviteCode;
    authManager.setPendingInviteCode(inviteCode);
    clearFieldError('regInviteError');
    setInviteHint(inviteCode ? '邀请码将在注册时校验' : '填写邀请码可额外获得 2 个豆子；同设备或同网络邀请不计奖励');
  });
  if (regInvite) regInvite.addEventListener('blur', () => {
    if (regInvite.value) validateInviteInput(regInvite.value);
    else setInviteHint('填写邀请码可额外获得 2 个豆子；同设备或同网络邀请不计奖励');
  });
  if (loginEmail) loginEmail.addEventListener('blur', () => {
    const v = loginEmail.value.trim();
    if (v && !_emailRe.test(v)) setFieldError('loginEmailError', '请输入有效的邮箱地址');
    else clearFieldError('loginEmailError');
  });

  // Send code button
  const sendCodeBtn = $('sendCodeBtn');
  if (sendCodeBtn) {
    sendCodeBtn.addEventListener('click', async () => {
      const email = regEmail ? regEmail.value.trim() : '';
      if (!email) { setFieldError('regEmailError', '请输入邮箱'); return; }
      if (!_emailRe.test(email)) { setFieldError('regEmailError', '请输入有效的邮箱地址'); return; }
      clearFieldError('regEmailError');
      sendCodeBtn.disabled = true;
      sendCodeBtn.textContent = '发送中…';
      const res = await authManager.sendCode(email, 'register');
      if (res.error) {
        setFieldError('regEmailError', res.error);
        sendCodeBtn.disabled = false;
        sendCodeBtn.textContent = '发送验证码';
      } else {
        showToast('验证码已发送到邮箱');
        let sec = 60;
        const timer = setInterval(() => {
          sec--;
          sendCodeBtn.textContent = `${sec}s`;
          if (sec <= 0) {
            clearInterval(timer);
            sendCodeBtn.disabled = false;
            sendCodeBtn.textContent = '发送验证码';
          }
        }, 1000);
      }
    });
  }

  // Register form
  const regForm = $('registerForm');
  if (regForm) {
    regForm.addEventListener('submit', async e => {
      e.preventDefault();
      const email = regEmail ? regEmail.value.trim() : '';
      const code = regCode ? regCode.value.trim() : '';
      const pw = regPw ? regPw.value : '';
      const pwc = regPwConfirm ? regPwConfirm.value : '';
      const inviteCode = regInvite ? normalizeInviteCode(regInvite.value) : '';

      // Validate
      let valid = true;
      if (!email || !_emailRe.test(email)) { setFieldError('regEmailError', '请输入有效的邮箱地址'); valid = false; }
      else clearFieldError('regEmailError');
      if (!code || code.length !== 6) { setFieldError('regCodeError', '请输入6位验证码'); valid = false; }
      else clearFieldError('regCodeError');
      if (!pw || pw.length < 6) { setFieldError('regPasswordError', '密码至少6位'); valid = false; }
      else clearFieldError('regPasswordError');
      if (pw !== pwc) { setFieldError('regPasswordConfirmError', '两次密码不一致'); valid = false; }
      else clearFieldError('regPasswordConfirmError');
      if (regInvite && regInvite.value !== inviteCode) regInvite.value = inviteCode;
      authManager.setPendingInviteCode(inviteCode);
      if (!valid) return;

      const btn = regForm.querySelector('button[type=submit]');
      setSubmitLoading(btn, true, '注册中…');
      const res = await authManager.register(email, code, pw, inviteCode);
      if (res.error) {
        setSubmitLoading(btn, false, '注册');
        // Map server error to appropriate field
        if (res.error.includes('邮箱')) setFieldError('regEmailError', res.error);
        else if (res.error.includes('验证码')) setFieldError('regCodeError', res.error);
        else if (res.error.includes('邀请码')) setFieldError('regInviteError', res.error);
        else if (res.error.includes('密码')) setFieldError('regPasswordError', res.error);
        else showToast(res.error, 'error');
      } else {
        setSubmitLoading(btn, false, '注册');
        authManager.setPendingInviteCode('');
        setInviteHint('填写邀请码可额外获得 2 个豆子；同设备或同网络邀请不计奖励');
        hideAuthModal();
        _modalForced = false;
        updateUserUI();
        const totalReward = Number(res.register_reward || 0) + Number(res.invitee_reward || 0);
        let rewardText = res.invite_applied ? `🎉 注册成功！已赠送 ${totalReward} 个豆子（含邀请码奖励）` : `🎉 注册成功！已赠送 ${totalReward} 个豆子`;
        if (res.invite_blocked_reason) rewardText += `；当前邀请未计奖励：${res.invite_blocked_reason}`;
        showToast(rewardText);
      }
    });
  }

  // Login form
  const loginForm = $('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async e => {
      e.preventDefault();
      const email = loginEmail ? loginEmail.value.trim() : '';
      const pw = loginPw ? loginPw.value : '';

      let valid = true;
      if (!email) { setFieldError('loginEmailError', '请输入邮箱地址'); valid = false; }
      else clearFieldError('loginEmailError');
      if (!pw) { setFieldError('loginPasswordError', '请输入密码'); valid = false; }
      else clearFieldError('loginPasswordError');
      if (!valid) return;

      const btn = loginForm.querySelector('button[type=submit]');
      setSubmitLoading(btn, true, '登录中…');
      const res = await authManager.login(email, pw);
      if (res.error) {
        setSubmitLoading(btn, false, '登录');
        if (res.error.includes('过多')) showToast(res.error, 'error');
        else setFieldError('loginPasswordError', res.error);
      } else {
        setSubmitLoading(btn, false, '登录');
        hideAuthModal();
        _modalForced = false;
        updateUserUI();
        showToast('登录成功');
      }
    });
  }

  // Forgot password link
  const forgotLink = $('forgotPasswordLink');
  if (forgotLink) {
    forgotLink.addEventListener('click', e => {
      e.preventDefault();
      showToast('密码重置功能即将上线', 'error');
    });
  }

  // No-beans modal
  const beansModal = $('noBeansModal');
  if (beansModal) {
    const closeBeansBtn = $('noBeansClose');
    if (closeBeansBtn) closeBeansBtn.onclick = () => beansModal.classList.add('hidden');
    beansModal.addEventListener('click', e => { if (e.target === beansModal) beansModal.classList.add('hidden'); });
    const inviteEarnBtn = $('inviteEarnBtn');
    if (inviteEarnBtn) inviteEarnBtn.onclick = () => { beansModal.classList.add('hidden'); showInviteModal(); };
    const goRechargeBtn = $('goRechargeBtn');
    if (goRechargeBtn) goRechargeBtn.onclick = () => { beansModal.classList.add('hidden'); showRechargeModal(); };
  }

  // Invite modal
  const inviteModal = $('inviteModal');
  if (inviteModal) {
    const closeInviteBtn = $('inviteModalClose');
    if (closeInviteBtn) closeInviteBtn.onclick = hideInviteModal;
    inviteModal.addEventListener('click', e => { if (e.target === inviteModal) hideInviteModal(); });

    const copyCodeBtn = $('copyInviteCodeBtn');
    if (copyCodeBtn) copyCodeBtn.addEventListener('click', async () => {
      const ok = await copyText(invitePayload?.invite_code || '');
      showToast(ok ? '邀请码已复制' : '复制失败，请手动复制', ok ? 'success' : 'error');
    });

    const copyLinkBtn = $('copyInviteLinkBtn');
    if (copyLinkBtn) copyLinkBtn.addEventListener('click', async () => {
      const ok = await copyText(invitePayload?.invite_link || '');
      showToast(ok ? '邀请链接已复制' : '复制失败，请手动复制', ok ? 'success' : 'error');
    });

    const copyMessageBtn = $('copyInviteMessageBtn');
    if (copyMessageBtn) copyMessageBtn.addEventListener('click', async () => {
      const message = invitePayload ? `${invitePayload.share_message}\n${invitePayload.invite_link}` : '';
      const ok = await copyText(message);
      showToast(ok ? '邀请文案已复制' : '复制失败，请手动复制', ok ? 'success' : 'error');
    });
  }

  // ── Recharge Modal ──
  let _packagesData = null;
  let _currentOrderNo = null;
  let _qrcodeWechat = '';
  let _qrcodeAlipay = '';
  let _currentPayMethod = 'alipay';

  async function loadPackages() {
    if (_packagesData) return _packagesData;
    try {
      const res = await authManager.getPackages();
      _packagesData = res.packages || [];
      _qrcodeWechat = res.qrcode_wechat || '';
      _qrcodeAlipay = res.qrcode_alipay || '';
    } catch (e) { _packagesData = []; }
    return _packagesData;
  }

  function renderPackages(packages) {
    const beanGrid = $('rechargeGrid');
    const memberGrid = $('memberGrid');
    if (!beanGrid || !memberGrid) return;

    const beanPkgs = packages.filter(p => p.type === 'beans');
    const memberPkgs = packages.filter(p => p.type === 'member');

    beanGrid.innerHTML = beanPkgs.map(p => {
      const unit = (parseFloat(p.price) / p.beans).toFixed(2);
      const saveTag = p.beans >= 100 ? '<span class="rc-save">省 38%</span>' : p.beans >= 30 ? '<span class="rc-save">省 11%</span>' : '';
      return `
      <div class="recharge-card" data-pkg="${p.id}">
        ${saveTag}
        <div class="rc-beans">🫘 ${p.beans}</div>
        <div class="rc-price">¥${p.price}</div>
        <div class="rc-unit">¥${unit}/豆</div>
        <div class="rc-benefit">可生成 ${p.beans} 个图案</div>
      </div>`;
    }).join('');

    memberGrid.innerHTML = memberPkgs.map(p => {
      const daily = (parseFloat(p.price) / p.days).toFixed(2);
      return `
      <div class="recharge-card ${p.id === 'yearly' ? 'featured' : ''}" data-pkg="${p.id}">
        <div class="rc-name">${p.name}</div>
        <div class="rc-beans">🫘 ${p.beans} 豆</div>
        <div class="rc-price">¥${p.price}</div>
        <div class="rc-unit">${p.days}天 · ¥${daily}/天</div>
        <div class="rc-benefit">豆子 + 全部会员权益</div>
      </div>`;
    }).join('');

    document.querySelectorAll('.recharge-card').forEach(card => {
      card.addEventListener('click', () => handlePackageClick(card.dataset.pkg));
    });
  }

  function showStep(step) {
    $('rechargeStep1')?.classList.toggle('hidden', step !== 1);
    $('rechargeStep2')?.classList.toggle('hidden', step !== 2);
    $('rechargeStep3')?.classList.toggle('hidden', step !== 3);
  }

  async function showRechargeModal() {
    if (!authManager.isLoggedIn) { showAuthModal('请先登录后再充值'); return; }
    const modal = $('rechargeModal');
    if (!modal) return;
    const pkgs = await loadPackages();
    renderPackages(pkgs);
    const beansEl = $('rechargeCurrentBeans');
    if (beansEl) beansEl.textContent = authManager.beans;
    showStep(1);
    modal.classList.remove('hidden');
  }

  function hideRechargeModal() {
    $('rechargeModal')?.classList.add('hidden');
  }

  function updateQrImage() {
    const img = $('payQrImage');
    if (!img) return;
    const src = _qrcodeAlipay;
    img.src = src || '';
    if (!src) img.alt = '收款码未配置，请联系管理员';
  }

  async function handlePackageClick(packageId) {
    showToast('正在创建订单…');
    _lastPackageId = packageId;
    const res = await authManager.createOrder(packageId);
    if (res.error) { showToast(res.error, 'error'); return; }

    _currentOrderNo = res.order_no;

    // Online payment via xunhupay — redirect to payment page
    if (res.pay_url && res.online_pay) {
      window.open(res.pay_url, '_blank');
      // Show step 3 with confirm button
      _resetPayStep3();
      const waitNo = $('payWaitOrderNo');
      if (waitNo) waitNo.textContent = res.order_no;
      showStep(3);
      // Start background polling
      _pollPaymentStatus(res.order_no);
      return;
    }

    // Fallback: QR code mode
    if (res.qrcode_wechat) _qrcodeWechat = res.qrcode_wechat;
    if (res.qrcode_alipay) _qrcodeAlipay = res.qrcode_alipay;

    // Fill step 2
    const nameEl = $('payPkgName'); if (nameEl) nameEl.textContent = res.package_name;
    const amtEl = $('payAmount'); if (amtEl) amtEl.textContent = '¥' + res.amount;
    const amtHint = $('payAmountHint'); if (amtHint) amtHint.textContent = '¥' + res.amount;
    const noEl = $('payOrderNo'); if (noEl) noEl.textContent = res.order_no;
    const noNote = $('payOrderNoNote'); if (noNote) noNote.textContent = res.order_no;

    // Show benefits summary
    const summaryEl = $('payBenefitsSummary');
    if (summaryEl) {
      const pkg = (_packagesData || []).find(p => p.id === packageId);
      if (pkg) {
        const items = [`🫘 获得 <b>${pkg.beans}</b> 豆子（可生成 ${pkg.beans} 个图案）`];
        if (pkg.type === 'member') {
          items.push(`👑 解锁 <b>${pkg.days} 天</b>会员权益`);
          items.push('⚡ 优先处理 / 💬 专属客服');
        }
        summaryEl.innerHTML = '<div class="pbs-title">充值后您将获得:</div>' + items.map(i => `<div class="pbs-item">${i}</div>`).join('');
      } else {
        summaryEl.innerHTML = '';
      }
    }

    _currentPayMethod = 'alipay';
    updateQrImage();
    showStep(2);
  }

  // Poll payment status for online pay
  let _pollTimer = null;
  function _pollPaymentStatus(orderNo) {
    if (_pollTimer) clearInterval(_pollTimer);
    let attempts = 0;
    _pollTimer = setInterval(async () => {
      attempts++;
      if (attempts > 120) { clearInterval(_pollTimer); return; }
      try {
        const res = await authManager.checkOrderStatus(orderNo);
        if (res.status === 'paid') {
          clearInterval(_pollTimer);
          _showPaySuccess(res.beans);
        }
      } catch(e) {}
    }, 5000);
  }

  function _showPaySuccess(beans) {
    const pkg = (_packagesData || []).find(p => p.id === _lastPackageId);
    const msgEl = $('paySuccessMsg');
    if (msgEl) {
      const name = pkg ? pkg.name : '';
      const b = pkg ? pkg.beans : (beans || '');
      msgEl.textContent = b ? `${b} 豆子已到账，可生成 ${b} 个图案` : '豆子已到账';
    }
    const waitActions = $('payWaitActions'); if (waitActions) waitActions.classList.add('hidden');
    const waitTitle = $('payWaitTitle'); if (waitTitle) waitTitle.classList.add('hidden');
    const waitMsg = $('payWaitMsg'); if (waitMsg) waitMsg.classList.add('hidden');
    const waitHint = $('payWaitHint'); if (waitHint) waitHint.classList.add('hidden');
    const successInfo = $('paySuccessInfo'); if (successInfo) successInfo.classList.remove('hidden');
    authManager.refreshUser().then(updateUserUI);
  }

  function _resetPayStep3() {
    const waitActions = $('payWaitActions'); if (waitActions) waitActions.classList.remove('hidden');
    const waitTitle = $('payWaitTitle'); if (waitTitle) waitTitle.classList.remove('hidden');
    const waitMsg = $('payWaitMsg'); if (waitMsg) waitMsg.classList.remove('hidden');
    const waitHint = $('payWaitHint'); if (waitHint) { waitHint.classList.remove('hidden'); waitHint.textContent = ''; }
    const successInfo = $('paySuccessInfo'); if (successInfo) successInfo.classList.add('hidden');
    const confirmBtn = $('payConfirmBtn'); if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = '✅ 我已支付完成'; }
  }

  let _lastPackageId = '';

  // Recharge modal events
  const rechargeModal = $('rechargeModal');
  if (rechargeModal) {
    const closeBtn = $('rechargeClose');
    if (closeBtn) closeBtn.onclick = hideRechargeModal;
    rechargeModal.addEventListener('click', e => { if (e.target === rechargeModal) hideRechargeModal(); });

    // "我已转账" button (QR code mode fallback)
    const payDoneBtn = $('payDoneBtn');
    if (payDoneBtn) payDoneBtn.addEventListener('click', () => {
      _resetPayStep3();
      const hintEl = $('payWaitHint');
      if (hintEl) hintEl.textContent = '管理员确认收款后，豆子将自动到账（通常5分钟内）';
      const waitNo = $('payWaitOrderNo');
      if (waitNo) waitNo.textContent = _currentOrderNo || '-';
      showStep(3);
    });

    // "我已支付完成" confirm button
    const payConfirmBtn = $('payConfirmBtn');
    if (payConfirmBtn) payConfirmBtn.addEventListener('click', async () => {
      if (!_currentOrderNo) return;
      payConfirmBtn.disabled = true;
      payConfirmBtn.textContent = '⏳ 正在查询…';
      const hintEl = $('payWaitHint');
      try {
        const res = await authManager.checkOrderStatus(_currentOrderNo);
        if (res.status === 'paid') {
          if (_pollTimer) clearInterval(_pollTimer);
          _showPaySuccess(res.beans);
        } else {
          if (hintEl) { hintEl.textContent = '暂未查询到支付结果，请稍等片刻后再试'; hintEl.style.color = '#f59e0b'; }
          payConfirmBtn.disabled = false;
          payConfirmBtn.textContent = '🔄 再次查询';
        }
      } catch (e) {
        if (hintEl) { hintEl.textContent = '查询失败，请稍后重试'; hintEl.style.color = '#ef4444'; }
        payConfirmBtn.disabled = false;
        payConfirmBtn.textContent = '🔄 再次查询';
      }
    });

    // Success page close button
    const paySuccessCloseBtn = $('paySuccessCloseBtn');
    if (paySuccessCloseBtn) paySuccessCloseBtn.addEventListener('click', hideRechargeModal);

    // Back button
    const payBackBtn = $('payBackBtn');
    if (payBackBtn) payBackBtn.addEventListener('click', () => showStep(1));

    // Wait close button
    const payWaitCloseBtn = $('payWaitCloseBtn');
    if (payWaitCloseBtn) payWaitCloseBtn.addEventListener('click', hideRechargeModal);
  }

  // Initial UI
  try { updateUserUI(); } catch(e) { console.error('updateUserUI error:', e); }
  if (authManager.isLoggedIn) authManager.refreshUser().then(updateUserUI).catch(e => console.error('refreshUser error:', e));

  return { updateUserUI, showAuthModal, hideAuthModal, showRechargeModal, showInviteModal, showNoBeansModal };
}
