/* ═══════════ Auth & Bean System ═══════════ */

const API_BASE = 'https://api.pindou.top';

class AuthManager {
  constructor() {
    this.token = localStorage.getItem('pindou_token') || '';
    this.user = JSON.parse(localStorage.getItem('pindou_user') || 'null');
    this.firstGenDone = !!localStorage.getItem('pindou_first_gen');
    this._patternTimer = null;
    this._timerTriggered = false;
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
    return h;
  }

  async sendCode(email, purpose = 'register') {
    const r = await fetch(`${API_BASE}/api/auth/send-code`, {
      method: 'POST', headers: this._headers(),
      body: JSON.stringify({ email, purpose })
    });
    return r.json();
  }

  async register(email, code, password) {
    const r = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST', headers: this._headers(),
      body: JSON.stringify({ email, code, password })
    });
    const d = await r.json();
    if (d.token) {
      this.token = d.token;
      this.user = d.user;
      this._save();
    }
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

  // Update header user area
  function updateUserUI() {
    const area = $('userArea');
    if (!area) return;
    if (authManager.isLoggedIn) {
      area.innerHTML = `
        <span class="user-beans" title="豆子余额">🫘 ${authManager.beans}</span>
        <span class="user-email">${authManager.user.email.split('@')[0]}</span>
        <button class="btn-text" id="logoutBtn">退出</button>
      `;
      const logoutBtn = $('logoutBtn');
      if (logoutBtn) logoutBtn.onclick = () => { authManager.logout(); updateUserUI(); showToast('已退出登录'); };
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
    if (message) {
      const tip = modal.querySelector('.auth-tip');
      if (tip) tip.textContent = message;
    }
    switchTab('register');
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
      if (!valid) return;

      const btn = regForm.querySelector('button[type=submit]');
      setSubmitLoading(btn, true, '注册中…');
      const res = await authManager.register(email, code, pw);
      if (res.error) {
        setSubmitLoading(btn, false, '注册');
        // Map server error to appropriate field
        if (res.error.includes('邮箱')) setFieldError('regEmailError', res.error);
        else if (res.error.includes('验证码')) setFieldError('regCodeError', res.error);
        else if (res.error.includes('密码')) setFieldError('regPasswordError', res.error);
        else showToast(res.error, 'error');
      } else {
        setSubmitLoading(btn, false, '注册');
        hideAuthModal();
        _modalForced = false;
        updateUserUI();
        showToast('🎉 注册成功！已赠送 3 个免费豆子');
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
  }

  // Initial UI
  updateUserUI();
  if (authManager.isLoggedIn) authManager.refreshUser().then(updateUserUI);

  return { updateUserUI, showAuthModal, hideAuthModal };
}
