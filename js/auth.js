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
    // First generation is free
    if (action === 'generate' && !this.firstGenDone) return false;
    // All other actions after first gen need login
    if (action === 'generate' && this.firstGenDone) return true;
    if (action === 'download' || action === 'pdf') return true;
    return false;
  }

  // Check if user has enough beans (logged in user)
  needsBeans() {
    return this.isLoggedIn && this.beans <= 0;
  }
}

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
      if (logoutBtn) logoutBtn.onclick = () => { authManager.logout(); updateUserUI(); };
    } else {
      area.innerHTML = `<button class="btn btn-sm btn-outline" id="loginTrigger">登录 / 注册</button>`;
      const trigger = $('loginTrigger');
      if (trigger) trigger.onclick = () => showAuthModal();
    }
  }

  // Show auth modal
  function showAuthModal(message) {
    const modal = $('authModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    if (message) {
      const tip = modal.querySelector('.auth-tip');
      if (tip) tip.textContent = message;
    }
    // Default to register tab
    switchTab('register');
  }

  function hideAuthModal() {
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

  // Send code button
  const sendCodeBtn = $('sendCodeBtn');
  if (sendCodeBtn) {
    sendCodeBtn.addEventListener('click', async () => {
      const email = $('regEmail').value.trim();
      if (!email) return alert('请输入邮箱');
      sendCodeBtn.disabled = true;
      sendCodeBtn.textContent = '发送中…';
      const res = await authManager.sendCode(email, 'register');
      if (res.error) {
        alert(res.error);
        sendCodeBtn.disabled = false;
        sendCodeBtn.textContent = '发送验证码';
      } else {
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
      const email = $('regEmail').value.trim();
      const code = $('regCode').value.trim();
      const pw = $('regPassword').value;
      if (!email || !code || !pw) return alert('请填写所有字段');
      const btn = regForm.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.textContent = '注册中…';
      const res = await authManager.register(email, code, pw);
      if (res.error) {
        alert(res.error);
        btn.disabled = false;
        btn.textContent = '注册';
      } else {
        hideAuthModal();
        updateUserUI();
      }
    });
  }

  // Login form
  const loginForm = $('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async e => {
      e.preventDefault();
      const email = $('loginEmail').value.trim();
      const pw = $('loginPassword').value;
      if (!email || !pw) return alert('请填写邮箱和密码');
      const btn = loginForm.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.textContent = '登录中…';
      const res = await authManager.login(email, pw);
      if (res.error) {
        alert(res.error);
        btn.disabled = false;
        btn.textContent = '登录';
      } else {
        hideAuthModal();
        updateUserUI();
      }
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
