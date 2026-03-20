/* ═══════════ Analytics helper (51.la) ═══════════ */
function trackEvent(action, params = {}) {
  if (typeof LA !== 'undefined' && LA.track) {
    const label = Object.entries(params).map(([k,v]) => `${k}=${v}`).join(',') || '';
    LA.track('event', { name: action, label });
  }
}

/* ═══════════ Usage limiter (localStorage) ═══════════ */
const UsageLimiter = {
  FREE_DAILY_LIMIT: 5,
  _key: 'bead_usage',

  _load() {
    try {
      const raw = localStorage.getItem(this._key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  },

  _today() { return new Date().toISOString().slice(0, 10); },

  getRemaining() {
    const data = this._load();
    if (!data || data.date !== this._today()) return this.FREE_DAILY_LIMIT;
    return Math.max(0, this.FREE_DAILY_LIMIT - (data.count || 0));
  },

  consume() {
    const today = this._today();
    let data = this._load();
    if (!data || data.date !== today) data = { date: today, count: 0, total: data ? data.total || 0 : 0 };
    data.count++;
    data.total++;
    localStorage.setItem(this._key, JSON.stringify(data));
    return this.FREE_DAILY_LIMIT - data.count;
  },

  getStats() {
    const data = this._load();
    return { todayCount: data && data.date === this._today() ? data.count : 0, totalCount: data ? data.total || 0 : 0 };
  }
};

/* ═══════════ History manager (localStorage) ═══════════ */
const HistoryManager = {
  _key: 'bead_history',
  MAX: 10,

  _load() {
    try {
      const raw = localStorage.getItem(this._key);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  },

  _save(list) {
    localStorage.setItem(this._key, JSON.stringify(list));
  },

  getAll() { return this._load(); },

  add(entry) {
    const list = this._load();
    list.unshift(entry);
    if (list.length > this.MAX) list.length = this.MAX;
    this._save(list);
  },

  remove(index) {
    const list = this._load();
    list.splice(index, 1);
    this._save(list);
  }
};

/**
 * BeadPatternApp — UI logic: upload, crop, render, compare, history, export.
 */
class BeadPatternApp {
  constructor() {
    this.converter = new BeadConverter();
    this.canvas    = document.getElementById('patternCanvas');
    this.ctx       = this.canvas.getContext('2d');
    this.image     = null;       // original loaded image
    this.croppedImage = null;    // cropped version (or null = use original)
    this.pattern   = null;
    this.isPro     = true;     // 全功能免费版

    // Auth system
    this.auth = new AuthManager();
    this.authUI = null;

    // View state
    this.zoom  = 1;
    this.panX  = 0;
    this.panY  = 0;
    this._panning  = false;
    this._lastX    = 0;
    this._lastY    = 0;

    // Rendering constants
    this.CELL       = 24;
    this.AXIS_M     = 30;
    this.showCodes  = true;
    this.showGrid   = true;
    this.showBoardLines = false;

    // Image adjustments
    this.brightness = 0;
    this.contrast   = 0;
    this.saturation = 0;

    // Crop state
    this._cropping = false;
    this._cropRect = null;      // {x, y, w, h} in preview-image fraction 0~1
    this._cropDrag = false;
    this._cropStart = null;

    // Comparison state
    this._comparing = false;

    // Edit mode state
    this.editMode = false;
    this._editDownPos = null;

    this._bind();
    this._updateUsageUI();
    this._renderHistory();

    // Init auth UI
    try {
      this.authUI = initAuthUI(this.auth);
    } catch(e) {
      console.error('initAuthUI failed:', e);
      // Fallback: at least show login button
      const area = document.getElementById('userArea');
      if (area) area.innerHTML = '<button class="btn btn-sm btn-outline" onclick="location.reload()">登录 / 注册</button>';
    }
  }

  /* ═══════════ Event binding ═══════════ */

  _bind() {
    const $ = id => document.getElementById(id);

    // ── Image upload ──
    const dropZone  = $('dropZone');
    const fileInput = $('fileInput');

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      const f = e.dataTransfer.files[0];
      if (f && f.type.startsWith('image/')) { this._loadImage(f); trackEvent('image_upload', { method: 'drop' }); }
    });
    fileInput.addEventListener('change', e => {
      if (e.target.files[0]) { this._loadImage(e.target.files[0]); trackEvent('image_upload', { method: 'click' }); }
    });

    // ── Gallery ──
    $('galleryBtn').addEventListener('click', () => this._openGallery());
    $('galleryClose').addEventListener('click', () => $('galleryModal').classList.add('hidden'));
    $('galleryModal').addEventListener('click', e => {
      if (e.target === $('galleryModal')) $('galleryModal').classList.add('hidden');
    });

    // ── Sliders ──
    $('widthSlider').addEventListener('input', e => {
      $('widthValue').textContent = e.target.value;
      this._refreshHeightLabel();
    });
    $('maxColorsSlider').addEventListener('input', e => {
      const v = parseInt(e.target.value);
      $('maxColorsValue').textContent = v === 0 ? '不限' : v;
    });

    // ── Image adjustment sliders ──
    ['brightness', 'contrast', 'saturation'].forEach(name => {
      $(name + 'Slider').addEventListener('input', e => {
        this[name] = parseInt(e.target.value);
        $(name + 'Value').textContent = e.target.value;
      });
    });
    $('resetAdjust').addEventListener('click', () => {
      ['brightness', 'contrast', 'saturation'].forEach(name => {
        this[name] = 0;
        $(name + 'Slider').value = 0;
        $(name + 'Value').textContent = '0';
      });
    });

    // ── Buttons ──
    $('convertBtn').addEventListener('click', () => {
      this._generate();
    });
    $('exportBtn').addEventListener('click', () => {
      if (this.auth.needsLogin('download')) {
        this.authUI.showAuthModal('注册后即可下载高清图片');
        return;
      }
      this._export();
    });
    $('exportPdfBtn').addEventListener('click', () => {
      if (this.auth.needsLogin('pdf')) {
        this.authUI.showAuthModal('注册后即可导出 PDF 分板图');
        return;
      }
      this._exportPDF();
    });

    // ── Comparison toggle ──
    $('compareBtn').addEventListener('click', () => this._toggleCompare());

    // ── Toggles ──
    $('showCodes').addEventListener('change', e => { this.showCodes = e.target.checked; this._draw(); });
    $('showGrid').addEventListener('change',  e => { this.showGrid  = e.target.checked; this._draw(); });
    $('showBoardLines').addEventListener('change', e => { this.showBoardLines = e.target.checked; this._draw(); });

    // ── Edit mode toggle ──
    $('editMode').addEventListener('change', e => {
      this.editMode = e.target.checked;
      this._updateEditModeUI();
    });

    // ── Canvas hover tooltip ──
    this.canvas.addEventListener('mousemove', e => this._onCanvasHover(e));
    this.canvas.addEventListener('mouseleave', () => $('beadTooltip').classList.add('hidden'));

    // ── Canvas zoom / pan ──
    this.canvas.addEventListener('wheel', e => {
      if (!this.pattern) return;   // allow normal page scroll when no pattern
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nz = Math.max(0.05, Math.min(15, this.zoom * factor));
      this.panX = mx - (mx - this.panX) * (nz / this.zoom);
      this.panY = my - (my - this.panY) * (nz / this.zoom);
      this.zoom = nz;
      this._draw();
    }, { passive: false });

    this.canvas.addEventListener('mousedown', e => {
      if (!this.pattern) return;   // don't capture when no pattern
      e.preventDefault();
      this._editDownPos = { x: e.clientX, y: e.clientY };
      this._panning = true; this._lastX = e.clientX; this._lastY = e.clientY;
      if (!this.editMode) this.canvas.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', e => {
      if (!this._panning) return;
      this.panX += e.clientX - this._lastX;
      this.panY += e.clientY - this._lastY;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      this._draw();
    });
    window.addEventListener('mouseup', e => {
      if (this._panning) {
        this._panning = false;
        this.canvas.style.cursor = this.editMode ? 'crosshair' : 'grab';
        // If edit mode + didn't drag far → treat as click
        if (this.editMode && this._editDownPos) {
          const dx = e.clientX - this._editDownPos.x;
          const dy = e.clientY - this._editDownPos.y;
          if (Math.abs(dx) < 4 && Math.abs(dy) < 4) {
            this._onBeadClick(e);
          }
        }
      }
      this._editDownPos = null;
    });

    // ── Touch support ──
    let lastTouchDist = 0;
    this.canvas.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        this._panning = true;
        this._lastX = e.touches[0].clientX;
        this._lastY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        lastTouchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
      e.preventDefault();
    }, { passive: false });

    this.canvas.addEventListener('touchmove', e => {
      if (e.touches.length === 1 && this._panning) {
        this.panX += e.touches[0].clientX - this._lastX;
        this.panY += e.touches[0].clientY - this._lastY;
        this._lastX = e.touches[0].clientX;
        this._lastY = e.touches[0].clientY;
        this._draw();
      } else if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        if (lastTouchDist > 0) {
          const factor = dist / lastTouchDist;
          const nz = Math.max(0.05, Math.min(15, this.zoom * factor));
          const rect = this.canvas.getBoundingClientRect();
          const cx = ((e.touches[0].clientX + e.touches[1].clientX) / 2) - rect.left;
          const cy = ((e.touches[0].clientY + e.touches[1].clientY) / 2) - rect.top;
          this.panX = cx - (cx - this.panX) * (nz / this.zoom);
          this.panY = cy - (cy - this.panY) * (nz / this.zoom);
          this.zoom = nz;
          this._draw();
        }
        lastTouchDist = dist;
      }
      e.preventDefault();
    }, { passive: false });

    this.canvas.addEventListener('touchend', () => { this._panning = false; lastTouchDist = 0; });

    // ── Resize observer ──
    const ro = new ResizeObserver(() => { if (this.pattern) this._fitAndDraw(); });
    ro.observe(document.querySelector('.pattern-container'));

    // ── Crop tool ──
    this._bindCrop();
  }

  /* ═══════════ Crop tool ═══════════ */

  _bindCrop() {
    const $ = id => document.getElementById(id);
    const overlay = $('cropOverlay');
    const cropBox = $('cropBox');

    $('cropToggle').addEventListener('click', () => {
      if (this._cropping) {
        this._exitCrop();
      } else {
        this._enterCrop();
      }
    });

    $('cropApply').addEventListener('click', () => this._applyCrop());
    $('cropCancel').addEventListener('click', () => this._exitCrop());

    // Draw crop rectangle by dragging on overlay
    overlay.addEventListener('mousedown', e => {
      e.preventDefault();
      const rect = overlay.getBoundingClientRect();
      this._cropDrag = true;
      this._cropStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      cropBox.style.left = this._cropStart.x + 'px';
      cropBox.style.top = this._cropStart.y + 'px';
      cropBox.style.width = '0';
      cropBox.style.height = '0';
    });

    overlay.addEventListener('mousemove', e => {
      if (!this._cropDrag) return;
      const rect = overlay.getBoundingClientRect();
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      const x = Math.min(this._cropStart.x, cx);
      const y = Math.min(this._cropStart.y, cy);
      const w = Math.abs(cx - this._cropStart.x);
      const h = Math.abs(cy - this._cropStart.y);
      cropBox.style.left = x + 'px';
      cropBox.style.top = y + 'px';
      cropBox.style.width = w + 'px';
      cropBox.style.height = h + 'px';
    });

    const finishDrag = () => {
      if (!this._cropDrag) return;
      this._cropDrag = false;
      const rect = overlay.getBoundingClientRect();
      const ow = rect.width, oh = rect.height;
      if (ow === 0 || oh === 0) return;
      const boxRect = cropBox.getBoundingClientRect();
      if (boxRect.width < 5 || boxRect.height < 5) return;   // too small, ignore
      // Store as fractions 0~1, clamped
      this._cropRect = {
        x: Math.max(0, (boxRect.left - rect.left) / ow),
        y: Math.max(0, (boxRect.top - rect.top) / oh),
        w: Math.min(1, boxRect.width / ow),
        h: Math.min(1, boxRect.height / oh),
      };
    };
    overlay.addEventListener('mouseup', finishDrag);
    window.addEventListener('mouseup', finishDrag);
  }

  _enterCrop() {
    if (!this.image) return;
    this._cropping = true;
    this._cropRect = null;
    document.getElementById('cropOverlay').classList.remove('hidden');
    document.getElementById('cropActions').classList.remove('hidden');
    document.getElementById('cropToggle').textContent = '✂️ 裁剪中…';
  }

  _exitCrop() {
    this._cropping = false;
    this._cropRect = null;
    document.getElementById('cropOverlay').classList.add('hidden');
    document.getElementById('cropActions').classList.add('hidden');
    document.getElementById('cropToggle').textContent = '✂️ 裁剪图片';
  }

  _applyCrop() {
    if (!this._cropRect || !this.image) { this._exitCrop(); return; }
    const { x, y, w, h } = this._cropRect;
    if (w < 0.02 || h < 0.02) { this._exitCrop(); return; }

    const img = this.image;
    const sx = Math.round(x * img.naturalWidth);
    const sy = Math.round(y * img.naturalHeight);
    const sw = Math.round(w * img.naturalWidth);
    const sh = Math.round(h * img.naturalHeight);

    const cvs = document.createElement('canvas');
    cvs.width = sw; cvs.height = sh;
    cvs.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

    const cropped = new Image();
    cropped.onload = () => {
      this.croppedImage = cropped;
      document.getElementById('previewImage').src = cropped.src;
      this._refreshHeightLabel();
      this._exitCrop();
      trackEvent('crop_applied');
    };
    cropped.src = cvs.toDataURL('image/png');
  }

  /* ═══════════ Image loading ═══════════ */

  _loadImage(file) {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        this.image = img;
        this.croppedImage = null;   // reset crop on new image
        this._imageDataUrl = e.target.result;   // keep for history
        document.getElementById('previewImage').src = e.target.result;
        document.getElementById('previewContainer').classList.remove('hidden');
        document.getElementById('convertBtn').disabled = false;
        this._refreshHeightLabel();
        this._exitCrop();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  _loadImageFromUrl(url, name) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.image = img;
      this.croppedImage = null;
      // Convert to data URL for preview & history
      const cvs = document.createElement('canvas');
      cvs.width = img.naturalWidth;
      cvs.height = img.naturalHeight;
      cvs.getContext('2d').drawImage(img, 0, 0);
      this._imageDataUrl = cvs.toDataURL('image/png');
      document.getElementById('previewImage').src = this._imageDataUrl;
      document.getElementById('previewContainer').classList.remove('hidden');
      document.getElementById('convertBtn').disabled = false;
      this._refreshHeightLabel();
      this._exitCrop();
      trackEvent('gallery_select', { name });
    };
    img.onerror = () => {
      alert('图片加载失败，请检查网络连接');
    };
    img.src = url;
  }

  /* ═══════════ Gallery ═══════════ */

  _openGallery() {
    if (typeof GALLERY_DATA === 'undefined' || !GALLERY_DATA.length) return;
    const modal = document.getElementById('galleryModal');
    const tabs = document.getElementById('galleryTabs');
    const grid = document.getElementById('galleryGrid');

    // Build tabs (only once)
    if (!tabs.children.length) {
      GALLERY_DATA.forEach((cat, i) => {
        const tab = document.createElement('div');
        tab.className = 'gallery-tab' + (i === 0 ? ' active' : '');
        tab.textContent = cat.name;
        tab.dataset.idx = i;
        tab.addEventListener('click', () => {
          tabs.querySelectorAll('.gallery-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          this._renderGalleryGrid(parseInt(tab.dataset.idx));
        });
        tabs.appendChild(tab);
      });
    }

    this._renderGalleryGrid(0);
    modal.classList.remove('hidden');
  }

  _renderGalleryGrid(catIdx) {
    const grid = document.getElementById('galleryGrid');
    const cat = GALLERY_DATA[catIdx];
    if (!cat) return;

    grid.innerHTML = cat.items.map((item, i) => `
      <div class="gallery-item" data-cat="${catIdx}" data-idx="${i}">
        <img src="${item.url}" alt="${item.name}" loading="lazy">
        <span>${item.name}</span>
      </div>
    `).join('');

    grid.querySelectorAll('.gallery-item').forEach(el => {
      el.addEventListener('click', () => {
        const ci = parseInt(el.dataset.cat);
        const ii = parseInt(el.dataset.idx);
        const item = GALLERY_DATA[ci].items[ii];
        this._loadImageFromUrl(item.url, item.name);
        document.getElementById('galleryModal').classList.add('hidden');
      });
    });
  }

  _refreshHeightLabel() {
    const src = this.croppedImage || this.image;
    if (!src) return;
    const w = parseInt(document.getElementById('widthSlider').value);
    document.getElementById('heightValue').textContent =
      Math.round(w * src.height / src.width);
  }

  /* ═══════════ Generate pattern ═══════════ */

  _generate() {
    const srcImage = this.croppedImage || this.image;
    if (!srcImage) return;

    const btn = document.getElementById('convertBtn');
    btn.textContent = '⏳ 生成中…';
    btn.disabled = true;

    requestAnimationFrame(() => {
      let width   = parseInt(document.getElementById('widthSlider').value);
      const brand     = document.getElementById('brandSelect').value;
      const maxColors = parseInt(document.getElementById('maxColorsSlider').value);
      const palette   = BEAD_PALETTES[brand].colors;

      // Free cap: max 80 beads wide
      if (!this.isPro && width > 80) width = 80;

      // Apply image adjustments
      const adjustedImage = this._applyAdjustments(srcImage);
      this.pattern = this.converter.convert(adjustedImage, width, palette, maxColors);

      document.getElementById('emptyState').classList.add('hidden');
      document.querySelector('.pattern-container').classList.add('has-pattern');
      this._fitAndDraw();
      this._renderLegend();
      this._renderStats();
      document.getElementById('exportBtn').disabled = false;
      document.getElementById('exportPdfBtn').disabled = false;
      document.getElementById('compareBtn').classList.remove('hidden');

      // Start 1-min timer to prompt registration (only if not logged in)
      if (!this.auth.isLoggedIn) {
        this.auth.startPatternTimer(() => {
          if (this.authUI) this.authUI.showAuthModal('注册即可保存作品，新用户赠送 3 个豆子', true);
        });
      }

      // Consume one use
      if (!this.isPro) UsageLimiter.consume();
      this._updateUsageUI();

      // Consume a bean for logged-in users
      if (this.auth.isLoggedIn) {
        this.auth.consumeBean('生成拼豆图案').then(res => {
          if (this.authUI) this.authUI.updateUserUI();
        });
      }

      // Save to history
      this._saveHistory(width, brand);

      trackEvent('generate_pattern', { width, colors: this.pattern.uniqueColors, beads: this.pattern.totalBeads });

      btn.textContent = '🔄 生成图案';
      btn.disabled = false;
    });
  }

  _updateUsageUI() {
    const el = document.getElementById('remainCount');
    if (!el) return;
    const remain = this.isPro ? '∞' : UsageLimiter.getRemaining();
    el.textContent = remain;
    const info = document.getElementById('usageInfo');
    if (!this.isPro && remain <= 1) info.classList.add('usage-low');
    else info.classList.remove('usage-low');
  }

  /* ═══════════ Canvas rendering ═══════════ */

  _fitAndDraw() {
    const container = document.querySelector('.pattern-container');
    this.canvas.width  = container.clientWidth;
    this.canvas.height = container.clientHeight;
    this.canvas.style.cursor = 'grab';

    if (!this.pattern) return;

    const pw = this.pattern.width  * this.CELL + this.AXIS_M * 2;
    const ph = this.pattern.height * this.CELL + this.AXIS_M * 2;
    this.zoom = Math.min(this.canvas.width / pw, this.canvas.height / ph, 1);
    this.panX = (this.canvas.width  - pw * this.zoom) / 2;
    this.panY = (this.canvas.height - ph * this.zoom) / 2;
    this._draw();
  }

  _draw() {
    if (!this.pattern) return;
    const { ctx, CELL, AXIS_M } = this;
    const { grid, width: W, height: H } = this.pattern;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);

    // ── Cells ──
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = grid[y][x];
        if (!c) continue;
        const px = AXIS_M + x * CELL, py = AXIS_M + y * CELL;
        ctx.fillStyle = c.hex;
        ctx.fillRect(px, py, CELL, CELL);
      }
    }

    // ── Grid lines ──
    if (this.showGrid) {
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 0.5;
      for (let x = 0; x <= W; x++) {
        const px = AXIS_M + x * CELL;
        ctx.beginPath(); ctx.moveTo(px, AXIS_M); ctx.lineTo(px, AXIS_M + H * CELL); ctx.stroke();
      }
      for (let y = 0; y <= H; y++) {
        const py = AXIS_M + y * CELL;
        ctx.beginPath(); ctx.moveTo(AXIS_M, py); ctx.lineTo(AXIS_M + W * CELL, py); ctx.stroke();
      }
      // Major grid every 5 or 10
      const major = W > 50 ? 10 : 5;
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= W; x += major) {
        const px = AXIS_M + x * CELL;
        ctx.beginPath(); ctx.moveTo(px, AXIS_M); ctx.lineTo(px, AXIS_M + H * CELL); ctx.stroke();
      }
      for (let y = 0; y <= H; y += major) {
        const py = AXIS_M + y * CELL;
        ctx.beginPath(); ctx.moveTo(AXIS_M, py); ctx.lineTo(AXIS_M + W * CELL, py); ctx.stroke();
      }
    }

    // ── Colour codes ──
    if (this.showCodes && this.zoom >= 0.35) {
      const fs = Math.min(10, CELL * 0.42);
      ctx.font = `bold ${fs}px -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const c = grid[y][x];
          if (!c) continue;
          const brightness = (c.rgb.r * 299 + c.rgb.g * 587 + c.rgb.b * 114) / 1000;
          ctx.fillStyle = brightness > 140 ? '#000' : '#FFF';
          ctx.fillText(c.code, AXIS_M + x * CELL + CELL / 2, AXIS_M + y * CELL + CELL / 2);
        }
      }
    }

    // ── Axis numbers (all 4 sides) ──
    ctx.fillStyle = '#555';
    ctx.font = '9px -apple-system, sans-serif';

    // Top
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    for (let x = 0; x < W; x++)
      ctx.fillText(x + 1, AXIS_M + x * CELL + CELL / 2, AXIS_M - 3);

    // Bottom
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let x = 0; x < W; x++)
      ctx.fillText(x + 1, AXIS_M + x * CELL + CELL / 2, AXIS_M + H * CELL + 3);

    // Left
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let y = 0; y < H; y++)
      ctx.fillText(y + 1, AXIS_M - 4, AXIS_M + y * CELL + CELL / 2);

    // Right
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (let y = 0; y < H; y++)
      ctx.fillText(y + 1, AXIS_M + W * CELL + 4, AXIS_M + y * CELL + CELL / 2);

    // ── Board split lines (29×29) ──
    if (this.showBoardLines) {
      ctx.strokeStyle = '#e53935';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      for (let bx = 29; bx < W; bx += 29) {
        const px = AXIS_M + bx * CELL;
        ctx.beginPath(); ctx.moveTo(px, AXIS_M); ctx.lineTo(px, AXIS_M + H * CELL); ctx.stroke();
      }
      for (let by = 29; by < H; by += 29) {
        const py = AXIS_M + by * CELL;
        ctx.beginPath(); ctx.moveTo(AXIS_M, py); ctx.lineTo(AXIS_M + W * CELL, py); ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // ── Border ──
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(AXIS_M, AXIS_M, W * CELL, H * CELL);

    ctx.restore();
  }

  /* ═══════════ Canvas hover tooltip ═══════════ */

  _onCanvasHover(e) {
    if (!this.pattern) return;
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    // Reverse pan/zoom to get grid coords
    const gx = Math.floor(((mx - this.panX) / this.zoom - this.AXIS_M) / this.CELL);
    const gy = Math.floor(((my - this.panY) / this.zoom - this.AXIS_M) / this.CELL);
    const { width: W, height: H, grid } = this.pattern;
    const tip = document.getElementById('beadTooltip');
    if (gx < 0 || gx >= W || gy < 0 || gy >= H || !grid[gy][gx]) {
      tip.classList.add('hidden');
      return;
    }
    const c = grid[gy][gx];
    tip.innerHTML = `<span class="tip-swatch" style="background:${c.hex}"></span><b>${c.code}</b> ${c.name}<br><small>坐标 (${gx+1}, ${gy+1})</small>`;
    tip.style.left = (e.clientX + 14) + 'px';
    tip.style.top  = (e.clientY + 14) + 'px';
    tip.classList.remove('hidden');
  }

  /* ═══════════ Manual bead editing ═══════════ */

  _updateEditModeUI() {
    const container = document.querySelector('.pattern-container');
    if (this.editMode) {
      this.canvas.style.cursor = 'crosshair';
      this.canvas.classList.add('canvas-edit-mode');
      // Add hint badge
      if (!container.querySelector('.edit-mode-hint')) {
        const hint = document.createElement('div');
        hint.className = 'edit-mode-hint';
        hint.textContent = '✏️ 编辑模式：点击珠子更换颜色';
        container.appendChild(hint);
      }
    } else {
      this.canvas.style.cursor = 'grab';
      this.canvas.classList.remove('canvas-edit-mode');
      const hint = container.querySelector('.edit-mode-hint');
      if (hint) hint.remove();
      this._closeBeadPicker();
    }
  }

  _screenToGrid(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = clientX - rect.left, my = clientY - rect.top;
    const gx = Math.floor(((mx - this.panX) / this.zoom - this.AXIS_M) / this.CELL);
    const gy = Math.floor(((my - this.panY) / this.zoom - this.AXIS_M) / this.CELL);
    return { gx, gy };
  }

  _onBeadClick(e) {
    if (!this.pattern) return;
    const { gx, gy } = this._screenToGrid(e.clientX, e.clientY);
    const { width: W, height: H, grid } = this.pattern;
    if (gx < 0 || gx >= W || gy < 0 || gy >= H) return;
    this._openBeadPicker(gx, gy, e.clientX, e.clientY);
  }

  _openBeadPicker(gx, gy, px, py) {
    const picker = document.getElementById('beadPicker');
    const brand = document.getElementById('brandSelect').value;
    const palette = BEAD_PALETTES[brand].colors;
    const current = this.pattern.grid[gy] && this.pattern.grid[gy][gx];

    // Position picker near click
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = px + 16, top = py - 40;
    if (left + 270 > vw) left = px - 280;
    if (top + 360 > vh) top = vh - 370;
    if (top < 8) top = 8;
    picker.style.left = left + 'px';
    picker.style.top = top + 'px';

    const title = document.getElementById('bpTitle');
    title.textContent = `坐标 (${gx+1}, ${gy+1})` + (current ? ` · ${current.code}` : '');

    // Store target coords
    this._editTarget = { gx, gy };

    // Render palette swatches
    const container = document.getElementById('bpColors');
    const searchInput = document.getElementById('bpSearch');
    searchInput.value = '';

    const renderSwatches = (filter = '') => {
      const lower = filter.toLowerCase();
      container.innerHTML = palette
        .filter(c => !filter || c.code.toLowerCase().includes(lower) || c.name.toLowerCase().includes(lower))
        .map(c => {
          const active = current && c.code === current.code ? ' bp-active' : '';
          return `<div class="bp-swatch${active}" data-code="${c.code}" style="background:${c.hex}" title="${c.code} ${c.name}"></div>`;
        }).join('');

      container.querySelectorAll('.bp-swatch').forEach(el => {
        el.addEventListener('click', () => this._applyBeadEdit(el.dataset.code));
      });
    };
    renderSwatches();

    searchInput.oninput = () => renderSwatches(searchInput.value);

    // Close button
    document.getElementById('bpClose').onclick = () => this._closeBeadPicker();

    picker.classList.remove('hidden');
    searchInput.focus();

    // Close on outside click (delayed to avoid immediate close)
    setTimeout(() => {
      this._pickerOutsideHandler = e => {
        if (!picker.contains(e.target)) this._closeBeadPicker();
      };
      window.addEventListener('mousedown', this._pickerOutsideHandler);
    }, 100);
  }

  _closeBeadPicker() {
    document.getElementById('beadPicker').classList.add('hidden');
    if (this._pickerOutsideHandler) {
      window.removeEventListener('mousedown', this._pickerOutsideHandler);
      this._pickerOutsideHandler = null;
    }
  }

  _applyBeadEdit(code) {
    if (!this._editTarget || !this.pattern) return;
    const { gx, gy } = this._editTarget;
    const brand = document.getElementById('brandSelect').value;
    const palette = BEAD_PALETTES[brand].colors;
    const newColor = palette.find(c => c.code === code);
    if (!newColor) return;

    // Prepare the full color object (with rgb/lab) like the converter does
    const rgb = this.converter.hexToRgb(newColor.hex);
    const lab = this.converter.rgbToLab(rgb.r, rgb.g, rgb.b);
    const colorObj = { ...newColor, rgb, lab };

    const oldColor = this.pattern.grid[gy][gx];

    // Update grid
    this.pattern.grid[gy][gx] = colorObj;

    // Update counts
    if (oldColor) {
      this.pattern.colorCounts[oldColor.code]--;
      if (this.pattern.colorCounts[oldColor.code] <= 0) {
        delete this.pattern.colorCounts[oldColor.code];
      }
    }
    this.pattern.colorCounts[code] = (this.pattern.colorCounts[code] || 0) + 1;
    this.pattern.uniqueColors = Object.keys(this.pattern.colorCounts).length;

    this._draw();
    this._renderLegend();
    this._renderStats();
    this._closeBeadPicker();
    trackEvent('bead_edit', { code, gx, gy });
  }

  /* ═══════════ Image adjustments ═══════════ */

  _applyAdjustments(img) {
    if (this.brightness === 0 && this.contrast === 0 && this.saturation === 0) return img;
    const cvs = document.createElement('canvas');
    cvs.width = img.naturalWidth || img.width;
    cvs.height = img.naturalHeight || img.height;
    const ctx = cvs.getContext('2d');
    // Use CSS filter for fast adjustment
    ctx.filter = `brightness(${100 + this.brightness}%) contrast(${100 + this.contrast}%) saturate(${100 + this.saturation}%)`;
    ctx.drawImage(img, 0, 0);
    return cvs;
  }

  /* ═══════════ Legend ═══════════ */

  _renderLegend() {
    if (!this.pattern) return;
    const section   = document.getElementById('legendSection');
    const container = document.getElementById('legendContent');
    section.classList.remove('hidden');

    const brand   = document.getElementById('brandSelect').value;
    const palette = BEAD_PALETTES[brand].colors;
    const sorted  = Object.entries(this.pattern.colorCounts).sort((a, b) => b[1] - a[1]);

    const totalBeads = this.pattern.totalBeads;
    container.innerHTML = sorted.map(([code, count]) => {
      const c = palette.find(p => p.code === code);
      if (!c) return '';
      const pct = (count / totalBeads * 100).toFixed(1);
      // bags: typical bag = 1000 beads
      const bags = Math.ceil(count / 1000);
      return `<div class="legend-item">
        <div class="legend-color" style="background:${c.hex}"></div>
        <span class="legend-code">${c.code}</span>
        <span class="legend-name">${c.name}</span>
        <span class="legend-count">${count}颗 ${pct}%</span>
        <span class="legend-bags">≈${bags}包</span>
      </div>`;
    }).join('');
  }

  /* ═══════════ Stats ═══════════ */

  _renderStats() {
    if (!this.pattern) return;
    const section = document.getElementById('statsSection');
    const content = document.getElementById('statsContent');
    section.classList.remove('hidden');

    const { width, height, totalBeads, uniqueColors } = this.pattern;
    // Estimate standard 29×29 pegboards needed
    const boards = Math.ceil(width / 29) * Math.ceil(height / 29);

    content.innerHTML = `
      <div class="stat-item"><span>尺寸</span><span class="stat-value">${width} × ${height}</span></div>
      <div class="stat-item"><span>总珠子数</span><span class="stat-value">${totalBeads.toLocaleString()}</span></div>
      <div class="stat-item"><span>使用颜色</span><span class="stat-value">${uniqueColors}</span></div>
      <div class="stat-item"><span>拼豆板 (29×29)</span><span class="stat-value">${boards} 块</span></div>
    `;
  }

  /* ═══════════ Export ═══════════ */

  _export() {
    if (!this.pattern) return;
    const { grid, width: W, height: H, colorCounts, totalBeads } = this.pattern;
    const CELL = 24, AXIS = 30;
    const brand   = document.getElementById('brandSelect').value;
    const palette = BEAD_PALETTES[brand].colors;
    const sorted  = Object.entries(colorCounts).sort((a, b) => b[1] - a[1]);

    // Calculate legend layout — horizontal color bar like reference
    const legendItemW = 140;
    const legendCols = Math.max(1, Math.floor((W * CELL) / legendItemW));
    const legendRows = Math.ceil(sorted.length / legendCols);
    const legendH = 20 + legendRows * 26 + 10;

    const totalW = AXIS * 2 + W * CELL;
    const totalH = AXIS * 2 + H * CELL + legendH;

    const cvs = document.createElement('canvas');
    cvs.width = totalW; cvs.height = totalH;
    const ctx = cvs.getContext('2d');

    // Background
    ctx.fillStyle = '#FFF';
    ctx.fillRect(0, 0, totalW, totalH);

    // Cells
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = grid[y][x]; if (!c) continue;
        ctx.fillStyle = c.hex;
        ctx.fillRect(AXIS + x * CELL, AXIS + y * CELL, CELL, CELL);
        // code
        const fs = Math.min(10, CELL * 0.42);
        ctx.font = `bold ${fs}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const br = (c.rgb.r * 299 + c.rgb.g * 587 + c.rgb.b * 114) / 1000;
        ctx.fillStyle = br > 140 ? '#000' : '#FFF';
        ctx.fillText(c.code, AXIS + x * CELL + CELL / 2, AXIS + y * CELL + CELL / 2);
      }
    }

    // Grid
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= W; x++) { ctx.beginPath(); ctx.moveTo(AXIS+x*CELL, AXIS); ctx.lineTo(AXIS+x*CELL, AXIS+H*CELL); ctx.stroke(); }
    for (let y = 0; y <= H; y++) { ctx.beginPath(); ctx.moveTo(AXIS, AXIS+y*CELL); ctx.lineTo(AXIS+W*CELL, AXIS+y*CELL); ctx.stroke(); }

    // Major grid
    const major = W > 50 ? 10 : 5;
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += major) { ctx.beginPath(); ctx.moveTo(AXIS+x*CELL, AXIS); ctx.lineTo(AXIS+x*CELL, AXIS+H*CELL); ctx.stroke(); }
    for (let y = 0; y <= H; y += major) { ctx.beginPath(); ctx.moveTo(AXIS, AXIS+y*CELL); ctx.lineTo(AXIS+W*CELL, AXIS+y*CELL); ctx.stroke(); }

    // Border
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5;
    ctx.strokeRect(AXIS, AXIS, W * CELL, H * CELL);

    // Board split lines (29×29)
    if (this.showBoardLines) {
      ctx.strokeStyle = '#e53935'; ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      for (let bx = 29; bx < W; bx += 29) {
        const px = AXIS + bx * CELL;
        ctx.beginPath(); ctx.moveTo(px, AXIS); ctx.lineTo(px, AXIS + H * CELL); ctx.stroke();
      }
      for (let by = 29; by < H; by += 29) {
        const py = AXIS + by * CELL;
        ctx.beginPath(); ctx.moveTo(AXIS, py); ctx.lineTo(AXIS + W * CELL, py); ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // Axis labels — all 4 sides
    ctx.fillStyle = '#555'; ctx.font = '9px sans-serif';

    // Top
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    for (let x = 0; x < W; x++)
      ctx.fillText(x+1, AXIS + x*CELL + CELL/2, AXIS - 2);

    // Bottom
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let x = 0; x < W; x++)
      ctx.fillText(x+1, AXIS + x*CELL + CELL/2, AXIS + H*CELL + 2);

    // Left
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let y = 0; y < H; y++)
      ctx.fillText(y+1, AXIS - 3, AXIS + y*CELL + CELL/2);

    // Right
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (let y = 0; y < H; y++)
      ctx.fillText(y+1, AXIS + W*CELL + 3, AXIS + y*CELL + CELL/2);

    // Legend — horizontal color-bar style
    const legTop = AXIS + H * CELL + AXIS + 4;
    ctx.font = '11px sans-serif'; ctx.textBaseline = 'middle';
    sorted.forEach(([code, count], i) => {
      const c = palette.find(p => p.code === code); if (!c) return;
      const col = i % legendCols, row = Math.floor(i / legendCols);
      const lx = AXIS + col * legendItemW, ly = legTop + row * 26;
      // Color swatch
      ctx.fillStyle = c.hex;
      ctx.fillRect(lx, ly, 20, 20);
      ctx.strokeStyle = '#ccc'; ctx.lineWidth = 0.5;
      ctx.strokeRect(lx, ly, 20, 20);
      // Code + count label
      ctx.fillStyle = '#333'; ctx.textAlign = 'left';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(`${code}`, lx + 24, ly + 7);
      ctx.font = '10px sans-serif'; ctx.fillStyle = '#666';
      ctx.fillText(`(${count})`, lx + 24, ly + 18);
    });

    // Watermark for free users
    if (!this.isPro) {
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = '#000';
      ctx.font = 'bold 36px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const wmText = 'BeadPattern.app';
      // Diagonal watermarks
      ctx.translate(totalW / 2, totalH / 2);
      ctx.rotate(-Math.PI / 6);
      for (let dy = -totalH; dy < totalH; dy += 120) {
        for (let dx = -totalW; dx < totalW; dx += 360) {
          ctx.fillText(wmText, dx, dy);
        }
      }
      ctx.restore();
    }

    // Download
    trackEvent('export_png', { width: W, height: H, pro: this.isPro });
    const a = document.createElement('a');
    a.download = `bead-pattern-${W}x${H}.png`;
    a.href = cvs.toDataURL('image/png');
    a.click();
  }

  /* ═══════════ Original / Pattern Comparison ═══════════ */

  _toggleCompare() {
    const srcImage = this.croppedImage || this.image;
    if (!this.pattern || !srcImage) return;
    this._comparing = !this._comparing;
    const btn = document.getElementById('compareBtn');
    const container = document.querySelector('.pattern-container');

    if (this._comparing) {
      btn.textContent = '🔀 隐藏原图';
      // Create comparison overlay
      let overlay = container.querySelector('.compare-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'compare-overlay';
        overlay.innerHTML = `<img src="${srcImage.src}" alt="原图">
          <div class="compare-slider-wrap">
            <label>透明度</label>
            <input type="range" min="0" max="100" value="55" id="compareAlpha">
          </div>`;
        container.appendChild(overlay);
        document.getElementById('compareAlpha').addEventListener('input', e => {
          overlay.querySelector('img').style.opacity = e.target.value / 100;
        });
      }
      overlay.style.display = '';
    } else {
      btn.textContent = '🔀 对比原图';
      const overlay = container.querySelector('.compare-overlay');
      if (overlay) overlay.style.display = 'none';
    }
    trackEvent('compare_toggle', { on: this._comparing });
  }

  /* ═══════════ History ═══════════ */

  _saveHistory(width, brand) {
    if (!this.pattern) return;
    // Generate small thumbnail from pattern
    const thumbSize = 60;
    const { grid, width: W, height: H } = this.pattern;
    const thumbCvs = document.createElement('canvas');
    const cellSize = Math.max(1, Math.floor(thumbSize / Math.max(W, H)));
    thumbCvs.width = W * cellSize;
    thumbCvs.height = H * cellSize;
    const tCtx = thumbCvs.getContext('2d');
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = grid[y][x];
        if (!c) continue;
        tCtx.fillStyle = c.hex;
        tCtx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }
    }

    HistoryManager.add({
      thumb: thumbCvs.toDataURL('image/png', 0.6),
      width: W,
      height: H,
      brand,
      colors: this.pattern.uniqueColors,
      beads: this.pattern.totalBeads,
      date: new Date().toLocaleString('zh-CN'),
    });
    this._renderHistory();
  }

  _renderHistory() {
    const container = document.getElementById('historyContent');
    const list = HistoryManager.getAll();
    if (list.length === 0) {
      container.innerHTML = '<p class="history-empty">暂无历史记录</p>';
      return;
    }
    container.innerHTML = list.map((h, i) => `
      <div class="history-item" data-idx="${i}">
        <img class="history-thumb" src="${h.thumb}" alt="缩略图">
        <div class="history-meta">
          <div class="h-size">${h.width}×${h.height} · ${h.colors}色</div>
          <div class="h-date">${h.date}</div>
        </div>
        <button class="history-del" data-idx="${i}" title="删除">✕</button>
      </div>
    `).join('');

    // Delete buttons
    container.querySelectorAll('.history-del').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        HistoryManager.remove(parseInt(btn.dataset.idx));
        this._renderHistory();
      });
    });
  }

  /* ═══════════ PDF Export ═══════════ */

  _exportPDF() {
    if (!this.pattern) return;
    if (typeof window.jspdf === 'undefined') {
      alert('PDF 库加载中，请稍后再试');
      return;
    }

    const { jsPDF } = window.jspdf;
    const { grid, width: W, height: H, colorCounts, totalBeads } = this.pattern;
    const brand   = document.getElementById('brandSelect').value;
    const palette = BEAD_PALETTES[brand].colors;
    const sorted  = Object.entries(colorCounts).sort((a, b) => b[1] - a[1]);

    // A4 landscape for wide patterns
    const isWide = W > H;
    const doc = new jsPDF({ orientation: isWide ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 10;

    // ── Page 1: Full overview ──
    doc.setFontSize(16);
    doc.text('拼豆图案', margin, margin + 6);
    doc.setFontSize(9);
    doc.text(`${W}×${H} | ${Object.keys(colorCounts).length}色 | ${totalBeads}珠 | ${BEAD_PALETTES[brand].name}`, margin, margin + 12);

    // Draw the full pattern as a scaled image
    const cellPx = 12;
    const overviewCvs = document.createElement('canvas');
    overviewCvs.width = W * cellPx;
    overviewCvs.height = H * cellPx;
    const oCtx = overviewCvs.getContext('2d');
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = grid[y][x]; if (!c) continue;
        oCtx.fillStyle = c.hex;
        oCtx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
      }
    }
    // Grid
    oCtx.strokeStyle = 'rgba(0,0,0,0.15)';
    oCtx.lineWidth = 0.5;
    for (let x = 0; x <= W; x++) { oCtx.beginPath(); oCtx.moveTo(x*cellPx,0); oCtx.lineTo(x*cellPx,H*cellPx); oCtx.stroke(); }
    for (let y = 0; y <= H; y++) { oCtx.beginPath(); oCtx.moveTo(0,y*cellPx); oCtx.lineTo(W*cellPx,y*cellPx); oCtx.stroke(); }

    const imgData = overviewCvs.toDataURL('image/png');
    const availW = pageW - margin * 2;
    const availH = pageH - margin * 2 - 18;
    const scale = Math.min(availW / (W * cellPx) * (72/25.4), availH / (H * cellPx) * (72/25.4), 1);
    const drawW = W * cellPx * scale * (25.4/72);
    const drawH = H * cellPx * scale * (25.4/72);
    doc.addImage(imgData, 'PNG', margin, margin + 18, drawW, drawH);

    // Watermark for free
    if (!this.isPro) {
      doc.setFontSize(28);
      doc.setTextColor(200, 200, 200);
      doc.text('BeadPattern.app', pageW / 2, pageH / 2, { align: 'center', angle: 30 });
      doc.setTextColor(0, 0, 0);
    }

    // ── Page 2: Board detail pages (29×29 grids) ──
    const BOARD = 29;
    const boardCols = Math.ceil(W / BOARD);
    const boardRows = Math.ceil(H / BOARD);

    for (let br = 0; br < boardRows; br++) {
      for (let bc = 0; bc < boardCols; bc++) {
        doc.addPage();
        const startX = bc * BOARD, startY = br * BOARD;
        const endX = Math.min(startX + BOARD, W);
        const endY = Math.min(startY + BOARD, H);
        const bw = endX - startX, bh = endY - startY;

        doc.setFontSize(10);
        doc.text(`拼豆板 ${br * boardCols + bc + 1} / ${boardCols * boardRows}  (行${br+1} 列${bc+1})`, margin, margin + 4);
        doc.setFontSize(8);
        doc.text(`坐标范围: (${startX+1},${startY+1}) ~ (${endX},${endY})`, margin, margin + 9);

        // Draw this board section with codes
        const boardCellPx = 18;
        const boardAxisPx = 24;
        const boardCvs = document.createElement('canvas');
        boardCvs.width = boardAxisPx + bw * boardCellPx;
        boardCvs.height = boardAxisPx + bh * boardCellPx;
        const bCtx = boardCvs.getContext('2d');
        bCtx.fillStyle = '#fff';
        bCtx.fillRect(0, 0, boardCvs.width, boardCvs.height);

        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const c = grid[y][x]; if (!c) continue;
            const px = boardAxisPx + (x - startX) * boardCellPx;
            const py = boardAxisPx + (y - startY) * boardCellPx;
            bCtx.fillStyle = c.hex;
            bCtx.fillRect(px, py, boardCellPx, boardCellPx);
            // Code text
            const fs = Math.min(8, boardCellPx * 0.45);
            bCtx.font = `bold ${fs}px sans-serif`;
            bCtx.textAlign = 'center'; bCtx.textBaseline = 'middle';
            const br2 = (c.rgb.r * 299 + c.rgb.g * 587 + c.rgb.b * 114) / 1000;
            bCtx.fillStyle = br2 > 140 ? '#000' : '#FFF';
            bCtx.fillText(c.code, px + boardCellPx / 2, py + boardCellPx / 2);
          }
        }
        // Grid
        bCtx.strokeStyle = 'rgba(0,0,0,0.2)'; bCtx.lineWidth = 0.5;
        for (let x = 0; x <= bw; x++) {
          bCtx.beginPath(); bCtx.moveTo(boardAxisPx+x*boardCellPx, boardAxisPx);
          bCtx.lineTo(boardAxisPx+x*boardCellPx, boardAxisPx+bh*boardCellPx); bCtx.stroke();
        }
        for (let y = 0; y <= bh; y++) {
          bCtx.beginPath(); bCtx.moveTo(boardAxisPx, boardAxisPx+y*boardCellPx);
          bCtx.lineTo(boardAxisPx+bw*boardCellPx, boardAxisPx+y*boardCellPx); bCtx.stroke();
        }
        // Axis labels
        bCtx.fillStyle = '#555'; bCtx.font = '8px sans-serif';
        bCtx.textAlign = 'center'; bCtx.textBaseline = 'bottom';
        for (let x = 0; x < bw; x++)
          bCtx.fillText(startX + x + 1, boardAxisPx + x * boardCellPx + boardCellPx / 2, boardAxisPx - 2);
        bCtx.textAlign = 'right'; bCtx.textBaseline = 'middle';
        for (let y = 0; y < bh; y++)
          bCtx.fillText(startY + y + 1, boardAxisPx - 3, boardAxisPx + y * boardCellPx + boardCellPx / 2);
        // Border
        bCtx.strokeStyle = '#333'; bCtx.lineWidth = 1;
        bCtx.strokeRect(boardAxisPx, boardAxisPx, bw * boardCellPx, bh * boardCellPx);

        const boardImgData = boardCvs.toDataURL('image/png');
        const bAvailW = pageW - margin * 2;
        const bAvailH = pageH - margin * 2 - 14;
        const bScale = Math.min(bAvailW / boardCvs.width * (72/25.4), bAvailH / boardCvs.height * (72/25.4), 1);
        const bDrawW = boardCvs.width * bScale * (25.4/72);
        const bDrawH = boardCvs.height * bScale * (25.4/72);
        doc.addImage(boardImgData, 'PNG', margin, margin + 14, bDrawW, bDrawH);
      }
    }

    // ── Last page: Materials list ──
    doc.addPage();
    doc.setFontSize(14);
    doc.text('材料清单', margin, margin + 6);
    doc.setFontSize(9);
    doc.text(`品牌: ${BEAD_PALETTES[brand].name}  |  总珠数: ${totalBeads}`, margin, margin + 13);

    let listY = margin + 20;
    doc.setFontSize(8);
    sorted.forEach(([code, count]) => {
      const c = palette.find(p => p.code === code);
      if (!c) return;
      const pct = (count / totalBeads * 100).toFixed(1);
      const bags = Math.ceil(count / 1000);
      // Color swatch
      const rgb = this.converter.hexToRgb(c.hex);
      doc.setFillColor(rgb.r, rgb.g, rgb.b);
      doc.rect(margin, listY - 2.5, 4, 4, 'F');
      doc.setDrawColor(180, 180, 180);
      doc.rect(margin, listY - 2.5, 4, 4, 'S');
      doc.setTextColor(0, 0, 0);
      doc.text(`${code}  ${c.name}  —  ${count}颗 (${pct}%)  ≈${bags}包`, margin + 6, listY);
      listY += 5;
      if (listY > pageH - margin) {
        doc.addPage();
        listY = margin + 8;
      }
    });

    trackEvent('export_pdf', { width: W, height: H });
    doc.save(`bead-pattern-${W}x${H}.pdf`);
  }
}

/* ── Bootstrap ── */
document.addEventListener('DOMContentLoaded', () => { window.app = new BeadPatternApp(); });
