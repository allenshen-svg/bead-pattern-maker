/* ═══════════ Analytics helper (51.la) ═══════════ */
function trackEvent(action, params = {}) {
  if (typeof LA !== 'undefined' && LA.track) {
    const label = Object.entries(params).map(([k,v]) => `${k}=${v}`).join(',') || '';
    LA.track('event', { name: action, label });
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
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
    this.emptyState = document.getElementById('emptyState');
    this.featureHighlightsBlock = document.getElementById('featureHighlightsBlock');
    this.controls = document.querySelector('.controls');
    this.uploadSection = document.querySelector('.upload-section');
    this._emptyStateHome = this.emptyState ? {
      parent: this.emptyState.parentNode,
      nextSibling: this.emptyState.nextSibling,
    } : null;
    this._featureHighlightsHome = this.featureHighlightsBlock ? {
      parent: this.featureHighlightsBlock.parentNode,
      nextSibling: this.featureHighlightsBlock.nextSibling,
    } : null;
    this.image     = null;       // original loaded image
    this.croppedImage = null;    // cropped version (or null = use original)
    this.pattern   = null;
    this._galleryTitlePattern = null;
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
    this.hideBg     = false;
    this.bgCode     = null;

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
    this._xhsNote = null;
    this._restoreOriginalDataUrl = '';
    this._restoredSource = false;
    this._restoreBusy = false;
    this._restoreMode = 'sharp';
    this._restoreScale = 4;
    this._restorePreviewDataUrl = '';
    this._restorePreviewMeta = null;
    this._restoreRenderToken = 0;

    // Edit mode state
    this.editMode = false;
    this._editDownPos = null;

    this._bind();
    this._updateUsageUI();
    this._renderHistory();
    this._syncRestoreUI();

    // Init auth UI
    try {
      this.authUI = initAuthUI(this.auth);
    } catch(e) {
      console.error('initAuthUI failed:', e);
      // Fallback: at least show login button
      const area = document.getElementById('userArea');
      if (area) area.innerHTML = '<button class="btn btn-sm btn-outline" onclick="location.reload()">登录 / 注册</button>';
    }

    this._syncMobileEmptyStatePlacement();
    window.addEventListener('resize', () => this._syncMobileEmptyStatePlacement());
  }

  _setLandingShowcaseHidden(hidden) {
    if (this.emptyState) this.emptyState.classList.toggle('hidden', hidden);
    if (this.featureHighlightsBlock) this.featureHighlightsBlock.classList.toggle('hidden', hidden);
  }

  _syncMobileEmptyStatePlacement() {
    if (!this.emptyState || !this.controls || !this.uploadSection || !this._emptyStateHome) return;

    const isMobile = window.innerWidth <= 800;
    if (isMobile) {
      if (this.emptyState.parentElement !== this.controls) {
        this.controls.insertBefore(this.emptyState, this.uploadSection);
      }
      this.emptyState.classList.add('empty-state-mobile');
      if (this.featureHighlightsBlock && this.featureHighlightsBlock.parentElement !== this.controls) {
        this.controls.appendChild(this.featureHighlightsBlock);
      }
      if (this.featureHighlightsBlock) this.featureHighlightsBlock.classList.add('feature-highlights-mobile');
      return;
    }

    this.emptyState.classList.remove('empty-state-mobile');
    if (this.featureHighlightsBlock) this.featureHighlightsBlock.classList.remove('feature-highlights-mobile');

    if (this.emptyState.parentElement !== this._emptyStateHome.parent) {
      const { parent, nextSibling } = this._emptyStateHome;
      if (nextSibling && nextSibling.parentNode === parent) {
        parent.insertBefore(this.emptyState, nextSibling);
      } else {
        parent.appendChild(this.emptyState);
      }
    }

    if (this.featureHighlightsBlock && this._featureHighlightsHome && this.featureHighlightsBlock.parentElement !== this._featureHighlightsHome.parent) {
      const { parent, nextSibling } = this._featureHighlightsHome;
      if (nextSibling && nextSibling.parentNode === parent) {
        parent.insertBefore(this.featureHighlightsBlock, nextSibling);
      } else {
        parent.appendChild(this.featureHighlightsBlock);
      }
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

    if ($('restoreBtn')) {
      $('restoreBtn').addEventListener('click', () => this._restoreSourceImage());
    }
    if ($('pixelRestoreClose') && $('pixelRestoreModal')) {
      $('pixelRestoreClose').addEventListener('click', () => this._closeRestoreModal());
      $('pixelRestoreModal').addEventListener('click', e => {
        if (e.target === $('pixelRestoreModal')) this._closeRestoreModal();
      });
    }
    document.querySelectorAll('[data-restore-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._restoreMode = btn.dataset.restoreMode || 'sharp';
        this._syncRestorePanelControls();
        this._renderRestorePreview();
      });
    });
    if ($('restoreScale')) {
      $('restoreScale').addEventListener('change', e => {
        this._restoreScale = parseInt(e.target.value, 10) || 4;
        this._syncRestorePanelControls();
        this._renderRestorePreview();
      });
    }
    if ($('restoreApplyBtn')) {
      $('restoreApplyBtn').addEventListener('click', () => this._applyRestorePreview());
    }

    // ── Xiaohongshu import ──
    if ($('xhsImportBtn') && $('xhsInput')) {
      $('xhsImportBtn').addEventListener('click', () => this._importXhsNote());
      $('xhsInput').addEventListener('keydown', e => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          this._importXhsNote();
        }
      });
    }

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

    // ── Fullscreen ──
    $('fullscreenBtn').addEventListener('click', () => this._toggleFullscreen());
    document.addEventListener('fullscreenchange', () => this._onFullscreenChange());
    document.addEventListener('webkitfullscreenchange', () => this._onFullscreenChange());
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && document.querySelector('.pattern-container.fake-fullscreen')) {
        e.preventDefault();
        this._toggleFullscreen();
      }
    });

    // ── Toggles ──
    $('showCodes').addEventListener('change', e => { this.showCodes = e.target.checked; this._draw(); });
    $('showGrid').addEventListener('change',  e => { this.showGrid  = e.target.checked; this._draw(); });
    $('showBoardLines').addEventListener('change', e => { this.showBoardLines = e.target.checked; this._draw(); });
    $('hideBg').addEventListener('change', e => { this.hideBg = e.target.checked; this._draw(); });

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
      this._imageDataUrl = cropped.src;
      this._restoreOriginalDataUrl = '';
      this._restoredSource = false;
      this._resetRestorePreviewState();
      document.getElementById('previewImage').src = cropped.src;
      this._refreshHeightLabel();
      this._exitCrop();
      this._setRestoreStatus('');
      this._syncRestoreUI();
      trackEvent('crop_applied');
    };
    cropped.src = cvs.toDataURL('image/png');
  }

  /* ═══════════ Image loading ═══════════ */

  _loadImage(file) {
    this._galleryTitlePattern = null;
    const reader = new FileReader();
    reader.onload = e => {
      this._applyImageDataUrl(e.target.result).catch(() => {
        alert('图片加载失败，请换一张图片再试');
      });
    };
    reader.readAsDataURL(file);
  }

  _resetRestorePreviewState() {
    this._restorePreviewDataUrl = '';
    this._restorePreviewMeta = null;
    this._restoreRenderToken += 1;

    const canvas = document.getElementById('restoreResultCanvas');
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }

    const meta = document.getElementById('restoreMeta');
    if (meta) meta.textContent = '';

    this._setRestorePanelStatus('');
  }

  _applyImageDataUrl(dataUrl, { preserveRestoreBase = false } = {}) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.image = img;
        this.croppedImage = null;
        this._imageDataUrl = dataUrl;
        document.getElementById('previewImage').src = dataUrl;
        document.getElementById('previewContainer').classList.remove('hidden');
        document.getElementById('convertBtn').disabled = false;
        this._resetRestorePreviewState();
        this._refreshHeightLabel();
        this._exitCrop();
        if (!preserveRestoreBase) {
          this._restoreOriginalDataUrl = '';
          this._restoredSource = false;
          this._setRestoreStatus('');
        }
        this._syncRestoreUI();
        resolve();
      };
      img.onerror = () => reject(new Error('图片加载失败，请换一张图片再试'));
      img.src = dataUrl;
    });
  }

  _loadImageFromUrl(url, name, source = 'gallery', galleryTemplate = null) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        // Convert to data URL for preview & history
        const cvs = document.createElement('canvas');
        cvs.width = img.naturalWidth;
        cvs.height = img.naturalHeight;
        cvs.getContext('2d').drawImage(img, 0, 0);
        const importedDataUrl = cvs.toDataURL('image/png');
        this._galleryTitlePattern = galleryTemplate && (galleryTemplate.rows || galleryTemplate.titleOverlayText)
          ? galleryTemplate
          : null;
        this._applyImageDataUrl(importedDataUrl).then(() => {
          if (source === 'gallery') {
            trackEvent('gallery_select', { name });
          } else {
            trackEvent('import_external_image', { source, name });
          }
          resolve();
        }).catch(reject);
      };
      img.onerror = () => {
        const error = new Error('图片加载失败，请换一张图片再试');
        if (source === 'gallery') {
          alert('图片加载失败，请检查网络连接');
        }
        reject(error);
      };
      img.src = url;
    });
  }

  _getActivePreviewDataUrl() {
    const preview = document.getElementById('previewImage');
    if (preview && preview.src && preview.src.startsWith('data:image/')) {
      return preview.src;
    }
    return this._imageDataUrl || '';
  }

  _getSbtiTitleTemplate() {
    const meta = this._galleryTitlePattern;
    if (!meta || !meta.image || !meta.rows || !meta.width) return null;
    if (meta.titleOverlayMode === 'source' || meta.titleOverlayMode === 'text-dual' || meta.titleOverlayMode === 'pixel-template') return null;
    return meta.image.includes('images/sbti_v2/') ? meta : null;
  }

  _pickSbtiTitleColor(srcImage, palette) {
    const preparedPalette = this.converter.preparePalette(palette);
    const cvs = document.createElement('canvas');
    cvs.width = srcImage.naturalWidth || srcImage.width;
    cvs.height = srcImage.naturalHeight || srcImage.height;
    const ctx = cvs.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(srcImage, 0, 0, cvs.width, cvs.height);
    const sampleHeight = Math.max(1, Math.round(cvs.height * 0.22));
    const data = ctx.getImageData(0, 0, cvs.width, sampleHeight).data;

    let rSum = 0, gSum = 0, bSum = 0, count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i+3];
      if (alpha < 24) continue;
      const r = data[i], g = data[i+1], b = data[i+2];
      if (g >= r + 10 && g >= b + 10 && (255 - r) + (255 - g) + (255 - b) > 20) {
        rSum += r;
        gSum += g;
        bSum += b;
        count++;
      }
    }

    if (!count) {
      return this.converter.findNearest(104, 159, 56, preparedPalette);
    }

    return this.converter.findNearest(
      Math.round(rSum / count),
      Math.round(gSum / count),
      Math.round(bSum / count),
      preparedPalette,
    );
  }

  _pickSbtiTitleBackground(palette) {
    const preparedPalette = this.converter.preparePalette(palette);
    return this.converter.findNearest(255, 255, 255, preparedPalette);
  }

  _generateSbtiPixelTextPattern(textConfig, colorCode) {
    if (
      !textConfig ||
      !textConfig.text ||
      !textConfig.fontSize ||
      typeof PixelTextGenerator === 'undefined' ||
      !PixelTextGenerator.generate
    ) {
      return null;
    }

    return PixelTextGenerator.generate(textConfig.text, textConfig.fontSize, colorCode, '.');
  }

  _applySbtiPixelTemplateOverlay(srcImage, palette, meta) {
    if (!this.pattern || !meta || !meta.rows || !meta.width || !meta.titlePixelText) return;

    const overlay = this._extractSbtiSourceTitleOverlay(srcImage);
    if (!overlay || !overlay.lines || overlay.lines.length < 2) return;

    const preparedPalette = this.converter.preparePalette(palette);
    const bgColor = this._pickSbtiTitleBackground(palette);
    const chineseColor = this.converter.findNearest(
      overlay.lines[0].rgb[0],
      overlay.lines[0].rgb[1],
      overlay.lines[0].rgb[2],
      preparedPalette,
    );
    const englishColor = this._pickSbtiTitleColor(srcImage, palette);
    const chinesePattern = this._generateSbtiPixelTextPattern(meta.titlePixelText, chineseColor.code);
    if (!chinesePattern || !chinesePattern.rows.length) return;

    const chineseWidth = chinesePattern.width;
    const chineseHeight = chinesePattern.rows.length;
    const englishWidth = meta.width;
    const englishHeight = meta.rows.length;
    const gap = meta.titleOverlayGap ?? 1;
    const chineseStartX = Math.max(0, Math.round((this.pattern.width - chineseWidth) / 2));
    const chineseStartY = Math.max(1, meta.titlePixelText.startY ?? 1);
    const englishStartX = Math.max(0, Math.round((this.pattern.width - englishWidth) / 2));
    const englishStartY = Math.max(chineseStartY + chineseHeight + gap, meta.englishStartY ?? 0);

    const clearMinX = Math.max(0, Math.min(chineseStartX, englishStartX) - 1);
    const clearMaxX = Math.min(
      this.pattern.width - 1,
      Math.max(chineseStartX + chineseWidth - 1, englishStartX + englishWidth - 1) + 1,
    );
    const clearMinY = Math.max(0, chineseStartY - 1);
    const clearMaxY = Math.min(
      this.pattern.height - 1,
      Math.max(chineseStartY + chineseHeight - 1, englishStartY + englishHeight - 1) + 1,
    );

    for (let y = clearMinY; y <= clearMaxY; y++) {
      for (let x = clearMinX; x <= clearMaxX; x++) {
        this.pattern.grid[y][x] = bgColor;
      }
    }

    chinesePattern.rows.forEach((rowStr, rowIndex) => {
      const y = chineseStartY + rowIndex;
      if (y < 0 || y >= this.pattern.height) return;
      rowStr.split(',').forEach((token, colIndex) => {
        if (token === '.' || !token) return;
        const x = chineseStartX + colIndex;
        if (x < 0 || x >= this.pattern.width) return;
        this.pattern.grid[y][x] = chineseColor;
      });
    });

    meta.rows.forEach((rowStr, rowIndex) => {
      const y = englishStartY + rowIndex;
      if (y < 0 || y >= this.pattern.height) return;
      rowStr.split(',').forEach((token, colIndex) => {
        if (token === '.' || !token) return;
        const x = englishStartX + colIndex;
        if (x < 0 || x >= this.pattern.width) return;
        this.pattern.grid[y][x] = englishColor;
      });
    });

    this._recountPattern();
  }

  _renderSbtiTextMask(textConfig) {
    if (!textConfig || !textConfig.text || !textConfig.width || !textConfig.height || !textConfig.font) {
      return null;
    }

    const source = document.createElement('canvas');
    source.width = 640;
    source.height = 280;
    const ctx = source.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, source.width, source.height);
    ctx.fillStyle = '#111';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = textConfig.font;
    ctx.fillText(textConfig.text, source.width / 2, source.height / 2);

    const data = ctx.getImageData(0, 0, source.width, source.height).data;
    let minX = source.width;
    let minY = source.height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        const index = (y * source.width + x) * 4;
        if (255 - data[index] <= 40) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }

    if (maxX < minX || maxY < minY) return null;

    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    const threshold = textConfig.threshold ?? 0.3;
    const mask = [];

    for (let gridY = 0; gridY < textConfig.height; gridY++) {
      const y0 = minY + gridY * boxHeight / textConfig.height;
      const y1 = minY + (gridY + 1) * boxHeight / textConfig.height;
      const row = [];

      for (let gridX = 0; gridX < textConfig.width; gridX++) {
        const x0 = minX + gridX * boxWidth / textConfig.width;
        const x1 = minX + (gridX + 1) * boxWidth / textConfig.width;
        let inkSamples = 0;
        let totalSamples = 0;

        for (let sy = 0; sy < 10; sy++) {
          const fy = y0 + (sy + 0.5) * (y1 - y0) / 10;
          const py = Math.min(source.height - 1, Math.max(0, Math.floor(fy)));
          for (let sx = 0; sx < 10; sx++) {
            const fx = x0 + (sx + 0.5) * (x1 - x0) / 10;
            const px = Math.min(source.width - 1, Math.max(0, Math.floor(fx)));
            const index = (py * source.width + px) * 4;
            totalSamples += 1;
            if (255 - data[index] > 40) inkSamples += 1;
          }
        }

        row.push(totalSamples > 0 && inkSamples / totalSamples >= threshold);
      }

      mask.push(row);
    }

    return mask;
  }

  _applySbtiTextTitleOverlay(srcImage, palette, meta) {
    if (!this.pattern || !meta || !Array.isArray(meta.titleOverlayText) || !meta.titleOverlayText.length) return;

    const overlay = this._extractSbtiSourceTitleOverlay(srcImage);
    if (!overlay || !overlay.lines || overlay.lines.length < meta.titleOverlayText.length) return;

    const preparedPalette = this.converter.preparePalette(palette);
    const bgColor = this._pickSbtiTitleBackground(palette);
    const renderedLines = meta.titleOverlayText.map((lineMeta, index) => {
      const mask = this._renderSbtiTextMask(lineMeta);
      if (!mask) return null;
      return {
        mask,
        width: lineMeta.width,
        height: lineMeta.height,
        color: this.converter.findNearest(
          overlay.lines[index].rgb[0],
          overlay.lines[index].rgb[1],
          overlay.lines[index].rgb[2],
          preparedPalette,
        ),
      };
    });

    if (renderedLines.some(line => !line)) return;

    const gap = meta.titleOverlayGap ?? 2;
    const totalHeight = renderedLines.reduce((sum, line) => sum + line.height, 0) + gap * Math.max(0, renderedLines.length - 1);
    let titleStartY = Math.max(
      1,
      Math.round((((overlay.minY + overlay.maxY) / 2) * this.pattern.height / overlay.sourceHeight) - totalHeight / 2),
    );
    if (titleStartY + totalHeight >= this.pattern.height) {
      titleStartY = Math.max(1, this.pattern.height - totalHeight - 1);
    }

    const centerX = ((overlay.minX + overlay.maxX + 1) / 2) * this.pattern.width / overlay.sourceWidth;
    const placements = [];
    let cursorY = titleStartY;
    for (const line of renderedLines) {
      const maxStartX = Math.max(0, this.pattern.width - line.width);
      let startX = Math.round(centerX - line.width / 2);
      startX = Math.max(0, Math.min(maxStartX, startX));
      placements.push({ startX, startY: cursorY });
      cursorY += line.height + gap;
    }

    let clearMinX = this.pattern.width;
    let clearMaxX = -1;
    let clearMinY = this.pattern.height;
    let clearMaxY = -1;
    placements.forEach((placement, index) => {
      const line = renderedLines[index];
      clearMinX = Math.min(clearMinX, placement.startX - 1);
      clearMaxX = Math.max(clearMaxX, placement.startX + line.width);
      clearMinY = Math.min(clearMinY, placement.startY - 1);
      clearMaxY = Math.max(clearMaxY, placement.startY + line.height);
    });

    clearMinX = Math.max(0, clearMinX);
    clearMaxX = Math.min(this.pattern.width - 1, clearMaxX);
    clearMinY = Math.max(0, clearMinY);
    clearMaxY = Math.min(this.pattern.height - 1, clearMaxY);

    for (let y = clearMinY; y <= clearMaxY; y++) {
      for (let x = clearMinX; x <= clearMaxX; x++) {
        this.pattern.grid[y][x] = bgColor;
      }
    }

    renderedLines.forEach((line, index) => {
      const placement = placements[index];
      line.mask.forEach((row, rowIndex) => {
        row.forEach((enabled, colIndex) => {
          if (!enabled) return;
          this.pattern.grid[placement.startY + rowIndex][placement.startX + colIndex] = line.color;
        });
      });
    });

    this._recountPattern();
  }

  _extractSbtiSourceTitleOverlay(srcImage) {
    const sourceWidth = srcImage.naturalWidth || srcImage.width;
    const sourceHeight = srcImage.naturalHeight || srcImage.height;
    if (!sourceWidth || !sourceHeight) return null;

    const cvs = document.createElement('canvas');
    cvs.width = sourceWidth;
    cvs.height = sourceHeight;
    const ctx = cvs.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(srcImage, 0, 0, sourceWidth, sourceHeight);

    const scanHeight = Math.max(1, Math.round(sourceHeight * 0.38));
    const imageData = ctx.getImageData(0, 0, sourceWidth, scanHeight).data;
    const rowCounts = new Array(scanHeight).fill(0);
    const isNearWhite = (rgb) => {
      const max = Math.max(rgb[0], rgb[1], rgb[2]);
      const min = Math.min(rgb[0], rgb[1], rgb[2]);
      return max >= 242 && (max - min) <= 12;
    };

    for (let y = 0; y < scanHeight; y++) {
      for (let x = 0; x < sourceWidth; x++) {
        const index = (y * sourceWidth + x) * 4;
        const alpha = imageData[index + 3];
        if (alpha < 24) continue;
        const rgb = this.converter.matteToWhite(
          imageData[index],
          imageData[index + 1],
          imageData[index + 2],
          alpha,
        );
        if (isNearWhite(rgb)) continue;
        rowCounts[y] += 1;
      }
    }

    const rowGroups = [];
    for (let y = 0; y < scanHeight; y++) {
      if (rowCounts[y] === 0) continue;
      const prev = rowGroups[rowGroups.length - 1];
      if (prev && y <= prev.maxY + 2) {
        prev.maxY = y;
        prev.total += rowCounts[y];
      } else {
        rowGroups.push({ minY: y, maxY: y, total: rowCounts[y] });
      }
    }

    const titleGroup = rowGroups.find(group => group.total >= 500 && (group.maxY - group.minY) >= 12) || null;
    if (!titleGroup) return null;

    const colCounts = new Array(sourceWidth).fill(0);
    for (let y = titleGroup.minY; y <= titleGroup.maxY; y++) {
      for (let x = 0; x < sourceWidth; x++) {
        const index = (y * sourceWidth + x) * 4;
        const alpha = imageData[index + 3];
        if (alpha < 24) continue;
        const rgb = this.converter.matteToWhite(
          imageData[index],
          imageData[index + 1],
          imageData[index + 2],
          alpha,
        );
        if (isNearWhite(rgb)) continue;
        colCounts[x] += 1;
      }
    }

    let minX = sourceWidth;
    let maxX = -1;
    for (let x = 0; x < sourceWidth; x++) {
      if (colCounts[x] > 0) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
    if (maxX < minX) return null;

    let centerTop = titleGroup.minY + (titleGroup.maxY - titleGroup.minY) * 0.3;
    let centerBottom = titleGroup.minY + (titleGroup.maxY - titleGroup.minY) * 0.72;
    for (let iteration = 0; iteration < 8; iteration++) {
      let sumTop = 0, weightTop = 0, sumBottom = 0, weightBottom = 0;
      for (let y = titleGroup.minY; y <= titleGroup.maxY; y++) {
        const weight = rowCounts[y];
        if (!weight) continue;
        if (Math.abs(y - centerTop) <= Math.abs(y - centerBottom)) {
          sumTop += y * weight;
          weightTop += weight;
        } else {
          sumBottom += y * weight;
          weightBottom += weight;
        }
      }
      if (weightTop) centerTop = sumTop / weightTop;
      if (weightBottom) centerBottom = sumBottom / weightBottom;
    }

    if (centerTop > centerBottom) {
      const tmp = centerTop;
      centerTop = centerBottom;
      centerBottom = tmp;
    }
    const splitY = Math.round((centerTop + centerBottom) / 2);

    const buildLineBox = (lineMinY, lineMaxY) => {
      let boxMinX = sourceWidth;
      let boxMaxX = -1;
      let boxMinY = lineMaxY;
      let boxMaxY = lineMinY - 1;
      const color = { r: 0, g: 0, b: 0, count: 0 };

      for (let y = lineMinY; y <= lineMaxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const index = (y * sourceWidth + x) * 4;
          const alpha = imageData[index + 3];
          if (alpha < 24) continue;
          const rgb = this.converter.matteToWhite(
            imageData[index],
            imageData[index + 1],
            imageData[index + 2],
            alpha,
          );
          if (isNearWhite(rgb)) continue;
          boxMinX = Math.min(boxMinX, x);
          boxMaxX = Math.max(boxMaxX, x);
          boxMinY = Math.min(boxMinY, y);
          boxMaxY = Math.max(boxMaxY, y);
          color.r += rgb[0];
          color.g += rgb[1];
          color.b += rgb[2];
          color.count += 1;
        }
      }

      if (boxMaxX < boxMinX || !color.count) return null;

      return {
        minX: boxMinX,
        maxX: boxMaxX,
        minY: boxMinY,
        maxY: boxMaxY,
        width: boxMaxX - boxMinX + 1,
        height: boxMaxY - boxMinY + 1,
        rgb: [
          Math.round(color.r / color.count),
          Math.round(color.g / color.count),
          Math.round(color.b / color.count),
        ],
      };
    };

    const topLine = buildLineBox(titleGroup.minY, splitY);
    const bottomLine = buildLineBox(splitY + 1, titleGroup.maxY);
    if (!topLine || !bottomLine) return null;

    return {
      sourceWidth,
      sourceHeight,
      minX: Math.min(topLine.minX, bottomLine.minX),
      maxX: Math.max(topLine.maxX, bottomLine.maxX),
      minY: Math.min(topLine.minY, bottomLine.minY),
      maxY: Math.max(topLine.maxY, bottomLine.maxY),
      lines: [topLine, bottomLine],
    };
  }

  _applySbtiSourceTitleOverlay(srcImage, palette) {
    if (!this.pattern) return;

    const overlay = this._extractSbtiSourceTitleOverlay(srcImage);
    if (!overlay || !overlay.lines || overlay.lines.length < 2) return;

    const preparedPalette = this.converter.preparePalette(palette);
    const bgColor = this._pickSbtiTitleBackground(palette);
    const lineConfigs = overlay.lines.map((line, index) => {
      const rawWidth = Math.max(1, Math.round(line.width * this.pattern.width / overlay.sourceWidth));
      const rawHeight = Math.max(1, Math.round(line.height * this.pattern.height / overlay.sourceHeight));
      const minHeight = index === 0 ? 5 : 4;
      const scale = Math.max(1, minHeight / rawHeight);
      return {
        line,
        color: this.converter.findNearest(line.rgb[0], line.rgb[1], line.rgb[2], preparedPalette),
        targetWidth: Math.max(1, Math.min(this.pattern.width - 4, Math.max(rawWidth + 2, Math.round(rawWidth * scale)))),
        targetHeight: Math.max(minHeight, Math.round(rawHeight * scale)),
        threshold: index === 0 ? 0.18 : 0.16,
      };
    });

    const gap = 2;
    const totalHeight = lineConfigs[0].targetHeight + gap + lineConfigs[1].targetHeight;
    let startY = Math.max(
      1,
      Math.round((((overlay.minY + overlay.maxY) / 2) * this.pattern.height / overlay.sourceHeight) - totalHeight / 2),
    );
    if (startY + totalHeight >= this.pattern.height) {
      startY = Math.max(1, this.pattern.height - totalHeight - 1);
    }

    const placements = lineConfigs.map((cfg, index) => {
      const centerX = ((cfg.line.minX + cfg.line.maxX + 1) / 2) * this.pattern.width / overlay.sourceWidth;
      const maxStartX = Math.max(0, this.pattern.width - cfg.targetWidth);
      let lineStartX = Math.round(centerX - cfg.targetWidth / 2);
      lineStartX = Math.max(0, Math.min(maxStartX, lineStartX));
      return {
        startX: lineStartX,
        startY: index === 0 ? startY : startY + lineConfigs[0].targetHeight + gap,
      };
    });

    const cvs = document.createElement('canvas');
    cvs.width = overlay.sourceWidth;
    cvs.height = overlay.sourceHeight;
    const ctx = cvs.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(srcImage, 0, 0, overlay.sourceWidth, overlay.sourceHeight);
    const imageData = ctx.getImageData(0, 0, overlay.sourceWidth, overlay.sourceHeight).data;
    const isNearWhite = (rgb) => {
      const max = Math.max(rgb[0], rgb[1], rgb[2]);
      const min = Math.min(rgb[0], rgb[1], rgb[2]);
      return max >= 242 && (max - min) <= 12;
    };

    let clearMinX = this.pattern.width;
    let clearMaxX = -1;
    let clearMinY = this.pattern.height;
    let clearMaxY = -1;

    placements.forEach((placement, index) => {
      const cfg = lineConfigs[index];
      clearMinX = Math.min(clearMinX, placement.startX - 1);
      clearMaxX = Math.max(clearMaxX, placement.startX + cfg.targetWidth);
      clearMinY = Math.min(clearMinY, placement.startY - 1);
      clearMaxY = Math.max(clearMaxY, placement.startY + cfg.targetHeight);
    });

    clearMinX = Math.max(0, clearMinX);
    clearMaxX = Math.min(this.pattern.width - 1, clearMaxX);
    clearMinY = Math.max(0, clearMinY);
    clearMaxY = Math.min(this.pattern.height - 1, clearMaxY);

    for (let y = clearMinY; y <= clearMaxY; y++) {
      for (let x = clearMinX; x <= clearMaxX; x++) {
        this.pattern.grid[y][x] = bgColor;
      }
    }

    const sampleResolution = 7;
    const paintLine = (cfg, placement) => {
      for (let y = 0; y < cfg.targetHeight; y++) {
        const y0 = cfg.line.minY + y * cfg.line.height / cfg.targetHeight;
        const y1 = cfg.line.minY + (y + 1) * cfg.line.height / cfg.targetHeight;
        for (let x = 0; x < cfg.targetWidth; x++) {
          const x0 = cfg.line.minX + x * cfg.line.width / cfg.targetWidth;
          const x1 = cfg.line.minX + (x + 1) * cfg.line.width / cfg.targetWidth;
          let inkSamples = 0;
          let totalSamples = 0;

          for (let sy = 0; sy < sampleResolution; sy++) {
            const fy = y0 + (sy + 0.5) * (y1 - y0) / sampleResolution;
            const py = Math.min(overlay.sourceHeight - 1, Math.max(0, Math.floor(fy)));
            for (let sx = 0; sx < sampleResolution; sx++) {
              const fx = x0 + (sx + 0.5) * (x1 - x0) / sampleResolution;
              const px = Math.min(overlay.sourceWidth - 1, Math.max(0, Math.floor(fx)));
              const index = (py * overlay.sourceWidth + px) * 4;
              const alpha = imageData[index + 3];
              if (alpha < 24) continue;
              totalSamples += 1;
              const rgb = this.converter.matteToWhite(
                imageData[index],
                imageData[index + 1],
                imageData[index + 2],
                alpha,
              );
              if (!isNearWhite(rgb)) inkSamples += 1;
            }
          }

          if (!totalSamples || inkSamples / totalSamples < cfg.threshold) continue;
          this.pattern.grid[placement.startY + y][placement.startX + x] = cfg.color;
        }
      }
    };

    paintLine(lineConfigs[0], placements[0]);
    paintLine(lineConfigs[1], placements[1]);

    this._recountPattern();
  }

  _recountPattern() {
    if (!this.pattern) return;
    const colorCounts = {};
    let totalBeads = 0;
    for (const row of this.pattern.grid) {
      for (const cell of row) {
        if (!cell) continue;
        colorCounts[cell.code] = (colorCounts[cell.code] || 0) + 1;
        totalBeads++;
      }
    }
    this.pattern.colorCounts = colorCounts;
    this.pattern.totalBeads = totalBeads;
    this.pattern.uniqueColors = Object.keys(colorCounts).length;
  }

  _applySbtiTitleOverlay(srcImage, palette) {
    const meta = this._galleryTitlePattern;
    if (!meta || !meta.image || !meta.image.includes('images/sbti_v2/') || !this.pattern) return;
    if (meta.titleOverlayMode === 'pixel-template') {
      this._applySbtiPixelTemplateOverlay(srcImage, palette, meta);
      return;
    }
    if (meta.titleOverlayMode === 'text-dual') {
      this._applySbtiTextTitleOverlay(srcImage, palette, meta);
      return;
    }
    if (meta.titleOverlayMode === 'source') {
      this._applySbtiSourceTitleOverlay(srcImage, palette);
      return;
    }

    const template = this._getSbtiTitleTemplate();
    if (!template) return;

    const titleColor = this._pickSbtiTitleColor(srcImage, palette);
    const bgColor = this._pickSbtiTitleBackground(palette);
    const startX = Math.max(0, Math.round((this.pattern.width - template.width) / 2));
    const startY = 1;

    for (let rowIndex = 0; rowIndex < template.rows.length; rowIndex++) {
      const y = startY + rowIndex;
      if (y >= this.pattern.height) continue;
      for (let colIndex = 0; colIndex < template.width; colIndex++) {
        const x = startX + colIndex;
        if (x < 0 || x >= this.pattern.width) continue;
        this.pattern.grid[y][x] = bgColor;
      }
    }

    template.rows.forEach((rowStr, rowIndex) => {
      const y = startY + rowIndex;
      if (y >= this.pattern.height) return;
      rowStr.split(',').forEach((code, colIndex) => {
        const token = code.trim();
        if (token === '.' || token === '') return;
        const x = startX + colIndex;
        if (x < 0 || x >= this.pattern.width) return;
        this.pattern.grid[y][x] = titleColor;
      });
    });

    this._recountPattern();
  }

  _setRestoreStatus(message, tone = 'info') {
    const el = document.getElementById('restoreStatus');
    if (!el) return;
    if (!message) {
      el.textContent = '';
      el.className = 'restore-status hidden';
      return;
    }
    el.textContent = message;
    el.className = `restore-status restore-status-${tone}`;
  }

  _setRestorePanelStatus(message, tone = 'info') {
    const el = document.getElementById('restorePanelStatus');
    if (!el) return;
    if (!message) {
      el.textContent = '';
      el.className = 'restore-panel-status hidden';
      return;
    }
    el.textContent = message;
    el.className = `restore-panel-status restore-panel-status-${tone}`;
  }

  _syncRestoreUI() {
    const btn = document.getElementById('restoreBtn');
    if (!btn) return;
    const hasImage = !!(this.image || this.croppedImage || this._getActivePreviewDataUrl());
    btn.disabled = this._restoreBusy || !hasImage;
    btn.textContent = this._restoredSource && this._restoreOriginalDataUrl
      ? '↺ 恢复导入图'
      : '🪄 像素还原';
  }

  _syncRestorePanelControls() {
    document.querySelectorAll('[data-restore-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.restoreMode === this._restoreMode);
    });

    const scale = document.getElementById('restoreScale');
    if (scale) scale.value = String(this._restoreScale);

    const applyBtn = document.getElementById('restoreApplyBtn');
    if (applyBtn) {
      applyBtn.disabled = this._restoreBusy || !this._restorePreviewDataUrl;
      applyBtn.textContent = this._restoreBusy ? '处理中…' : '应用结果到主图';
    }

    const meta = document.getElementById('restoreMeta');
    if (!meta) return;
    if (this._restorePreviewMeta) {
      const { sampledWidth, sampledHeight, outputWidth, outputHeight, mode, passes, scale: outputScale } = this._restorePreviewMeta;
      meta.textContent = mode === 'smooth'
        ? `提取 ${sampledWidth} × ${sampledHeight} 格子颜色 -> 平滑插画 ${outputScale}x -> 输出 ${outputWidth} × ${outputHeight}`
        : `提取 ${sampledWidth} × ${sampledHeight} 格子颜色 -> 像素底图 ${outputScale}x -> 输出 ${outputWidth} × ${outputHeight}`;
      return;
    }

    const width = parseInt(document.getElementById('widthSlider')?.value, 10) || 50;
    meta.textContent = `将按当前珠子宽度 ${width} 提取格子颜色`;
  }

  _openRestoreModal() {
    const modal = document.getElementById('pixelRestoreModal');
    const sourceDataUrl = this._getActivePreviewDataUrl();
    if (!modal || !sourceDataUrl) {
      this._setRestoreStatus('请先导入一张图片。', 'error');
      return;
    }

    const originalImg = document.getElementById('restoreOriginalImg');
    if (originalImg) originalImg.src = sourceDataUrl;

    modal.classList.remove('hidden');
    this._restorePreviewDataUrl = '';
    this._restorePreviewMeta = null;
    this._setRestorePanelStatus('正在浏览器本地提取格子颜色并生成预览...', 'info');
    this._syncRestorePanelControls();
    this._renderRestorePreview();
  }

  _closeRestoreModal() {
    const modal = document.getElementById('pixelRestoreModal');
    if (modal) modal.classList.add('hidden');
  }

  async _revertRestoredImage() {
    this._restoreBusy = true;
    this._syncRestoreUI();
    this._syncRestorePanelControls();
    this._setRestoreStatus('正在恢复原导入图...', 'info');
    try {
      await this._applyImageDataUrl(this._restoreOriginalDataUrl);
      this._setRestoreStatus('已恢复原导入图。', 'success');
      trackEvent('image_restore_revert');
    } catch (error) {
      this._setRestoreStatus(error.message || '恢复失败，请重新导入图片', 'error');
    } finally {
      this._restoreBusy = false;
      this._syncRestoreUI();
      this._syncRestorePanelControls();
    }
  }

  async _renderRestorePreview() {
    const srcImage = this.croppedImage || this.image;
    const restoreCanvas = document.getElementById('restoreResultCanvas');
    if (!srcImage || !restoreCanvas) return;
    if (typeof PixelRestoreEngine === 'undefined') {
      this._setRestorePanelStatus('像素还原模块未加载，请刷新页面后重试。', 'error');
      return;
    }

    const renderToken = ++this._restoreRenderToken;
    const gridWidth = parseInt(document.getElementById('widthSlider')?.value, 10) || 50;

    this._restoreBusy = true;
    this._restorePreviewDataUrl = '';
    this._restorePreviewMeta = null;
    this._syncRestoreUI();
    this._syncRestorePanelControls();
    this._setRestorePanelStatus(
      this._restoreMode === 'smooth'
        ? '正在本地生成平滑插画预览...' : '正在本地生成像素底图预览...',
      'info'
    );

    await new Promise(resolve => requestAnimationFrame(resolve));

    try {
      const result = PixelRestoreEngine.restore(srcImage, {
        gridWidth,
        mode: this._restoreMode,
        scale: this._restoreScale,
      });
      if (renderToken !== this._restoreRenderToken) return;

      restoreCanvas.width = result.outputWidth;
      restoreCanvas.height = result.outputHeight;
      const ctx = restoreCanvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, restoreCanvas.width, restoreCanvas.height);
      ctx.drawImage(result.outputCanvas, 0, 0);

      this._restorePreviewDataUrl = result.outputCanvas.toDataURL('image/png');
      this._restorePreviewMeta = result;
      this._setRestorePanelStatus(
        result.mode === 'smooth'
          ? `已提取 ${result.sampledWidth} × ${result.sampledHeight} 的格子颜色，并生成平滑插画输出。`
          : `已提取 ${result.sampledWidth} × ${result.sampledHeight} 的格子颜色，并生成像素底图输出。`,
        'success'
      );
    } catch (error) {
      if (renderToken !== this._restoreRenderToken) return;
      this._setRestorePanelStatus(error.message || '本地还原失败，请换一张图片再试。', 'error');
    } finally {
      if (renderToken === this._restoreRenderToken) {
        this._restoreBusy = false;
        this._syncRestoreUI();
        this._syncRestorePanelControls();
      }
    }
  }

  async _applyRestorePreview() {
    if (!this._restorePreviewDataUrl || !this._restorePreviewMeta) {
      this._setRestorePanelStatus('请先等待预览生成完成。', 'error');
      return;
    }

    const originalPreview = this._getActivePreviewDataUrl();
    if (!originalPreview) {
      this._setRestorePanelStatus('请先导入一张图片。', 'error');
      return;
    }

    const meta = this._restorePreviewMeta;
    this._restoreBusy = true;
    this._syncRestoreUI();
    this._syncRestorePanelControls();
    this._setRestorePanelStatus('正在应用还原结果到主图...', 'info');

    try {
      await this._applyImageDataUrl(this._restorePreviewDataUrl, { preserveRestoreBase: true });
      this._restoreOriginalDataUrl = originalPreview;
      this._restoredSource = true;
      this._closeRestoreModal();
      this._setRestoreStatus(
        meta.mode === 'smooth'
          ? `已在浏览器本地提取 ${meta.sampledWidth} × ${meta.sampledHeight} 的格子颜色，并输出 ${meta.outputWidth} × ${meta.outputHeight} 的平滑插画。`
          : `已在浏览器本地提取 ${meta.sampledWidth} × ${meta.sampledHeight} 的格子颜色，并输出 ${meta.outputWidth} × ${meta.outputHeight} 的像素底图。`,
        'success'
      );
      trackEvent('image_restore', {
        width: meta.sampledWidth,
        height: meta.sampledHeight,
        mode: meta.mode,
        scale: meta.scale,
      });
    } catch (error) {
      this._setRestorePanelStatus(error.message || '应用失败，请稍后再试。', 'error');
    } finally {
      this._restoreBusy = false;
      this._syncRestoreUI();
      this._syncRestorePanelControls();
    }
  }

  async _restoreSourceImage() {
    if (this._restoreBusy) return;

    if (this._restoredSource && this._restoreOriginalDataUrl) {
      await this._revertRestoredImage();
      return;
    }

    const activeDataUrl = this._getActivePreviewDataUrl();
    if (!activeDataUrl) {
      this._setRestoreStatus('请先导入一张图片。', 'error');
      return;
    }

    this._openRestoreModal();
  }

  _setXhsStatus(message, tone = 'info') {
    const el = document.getElementById('xhsStatus');
    if (!el) return;
    if (!message) {
      el.textContent = '';
      el.className = 'xhs-status hidden';
      return;
    }
    el.textContent = message;
    el.className = `xhs-status xhs-status-${tone}`;
  }

  _clearXhsResult() {
    this._xhsNote = null;
    const result = document.getElementById('xhsImportResult');
    const meta = document.getElementById('xhsImportMeta');
    const grid = document.getElementById('xhsImportGrid');
    if (result) result.classList.add('hidden');
    if (meta) meta.innerHTML = '';
    if (grid) grid.innerHTML = '';
  }

  async _importXhsNote() {
    const input = document.getElementById('xhsInput');
    const btn = document.getElementById('xhsImportBtn');
    if (!input || !btn) return;

    const rawText = input.value.trim();
    if (!rawText) {
      this._setXhsStatus('先粘贴小红书帖子链接或分享文案。', 'error');
      return;
    }

    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = '解析中...';
    this._clearXhsResult();
    this._setXhsStatus('正在解析帖子图片...', 'info');

    try {
      const response = await fetch(`${API_BASE}/api/import/xhs/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: rawText })
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || '解析失败，请稍后再试');
      }
      this._xhsNote = data;
      this._renderXhsResult(data);
      this._setXhsStatus(`已解析到 ${data.image_count || data.images.length} 张图片，请选择包含拼豆图案的那一张。`, 'success');
      trackEvent('xhs_note_parse', { images: data.images.length });
    } catch (error) {
      this._setXhsStatus(error.message || '解析失败，请稍后再试', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }

  _renderXhsResult(note) {
    const result = document.getElementById('xhsImportResult');
    const meta = document.getElementById('xhsImportMeta');
    const grid = document.getElementById('xhsImportGrid');
    if (!result || !meta || !grid || !note || !Array.isArray(note.images)) return;

    const desc = note.description
      ? escapeHtml(note.description)
      : '点击下方图片即可导入；如果帖子是多图，选择那张包含拼豆图案的图片即可。';
    meta.innerHTML = `
      <div class="xhs-note-title">${escapeHtml(note.title || '小红书帖子')}</div>
      <div class="xhs-note-desc">${desc}</div>
    `;

    grid.innerHTML = note.images.map((item, index) => {
      const size = item.width && item.height ? `${item.width} x ${item.height}` : '原图尺寸';
      return `
        <button type="button" class="xhs-card" data-index="${index}">
          <img src="${item.proxy_url}" alt="帖子图片 ${index + 1}" loading="lazy" crossorigin="anonymous">
          <span class="xhs-card-badge">第 ${index + 1} 张</span>
          <span class="xhs-card-meta">${size}</span>
        </button>
      `;
    }).join('');

    grid.querySelectorAll('.xhs-card').forEach(card => {
      card.addEventListener('click', async () => {
        const index = parseInt(card.dataset.index, 10);
        const item = note.images[index];
        if (!item) return;

        grid.querySelectorAll('.xhs-card').forEach(el => el.classList.remove('is-importing'));
        card.classList.add('is-importing');
        this._setXhsStatus(`正在导入第 ${index + 1} 张图片...`, 'info');

        try {
          await this._loadImageFromUrl(
            item.proxy_url,
            `${note.title || '小红书帖子'}-${index + 1}`,
            'xiaohongshu'
          );
          this._setXhsStatus('图片已导入。接下来直接点击“生成图案”即可还原。', 'success');
          trackEvent('xhs_image_import', { index: index + 1 });
        } catch (error) {
          this._setXhsStatus(error.message || '图片导入失败，请换一张再试', 'error');
        } finally {
          card.classList.remove('is-importing');
        }
      });
    });

    result.classList.remove('hidden');
  }

  /* ═══════════ Gallery ═══════════ */

  _openGallery() {
    const modal = document.getElementById('galleryModal');
    if (!this._galleryMode) this._galleryMode = 'pattern';

    // Mode switch buttons
    modal.querySelectorAll('.gallery-mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === this._galleryMode);
      btn.onclick = () => {
        this._galleryMode = btn.dataset.mode;
        modal.querySelectorAll('.gallery-mode-btn').forEach(b => b.classList.toggle('active', b === btn));
        this._galleryTabsBuilt = false;
        document.getElementById('galleryTabs').innerHTML = '';
        this._buildGalleryTabs();
        this._renderGalleryGrid(0);
        this._toggleTextPanel();
      };
    });

    this._buildGalleryTabs();
    this._renderGalleryGrid(0);
    this._toggleTextPanel();
    this._initPixelTextOnce();
    modal.classList.remove('hidden');
  }

  _toggleTextPanel() {
    const textPanel = document.getElementById('pixelTextPanel');
    const tabs = document.getElementById('galleryTabs');
    const grid = document.getElementById('galleryGrid');
    if (this._galleryMode === 'text') {
      textPanel.classList.remove('hidden');
      tabs.classList.add('hidden');
      grid.classList.add('hidden');
    } else {
      textPanel.classList.add('hidden');
      tabs.classList.remove('hidden');
      grid.classList.remove('hidden');
    }
  }

  _initPixelTextOnce() {
    if (this._ptInited) return;
    this._ptInited = true;
    const input = document.getElementById('ptInput');
    const genBtn = document.getElementById('ptGenBtn');
    const self = this;

    genBtn.addEventListener('click', () => self._generatePixelText());
    input.addEventListener('keydown', e => { if (e.key === 'Enter') self._generatePixelText(); });

    document.querySelectorAll('.pt-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        input.value = btn.dataset.text;
        self._generatePixelText();
      });
    });
  }

  _generatePixelText() {
    const text = document.getElementById('ptInput').value.trim();
    if (!text) return;
    const fontSize = parseInt(document.getElementById('ptSize').value);
    const fgColor = document.getElementById('ptFg').value;
    const bgColor = document.getElementById('ptBg').value;

    const patternData = PixelTextGenerator.generate(text, fontSize, fgColor, bgColor);
    if (!patternData) return;

    this._currentTextPattern = patternData;

    // Show preview
    const preview = document.getElementById('ptPreview');
    const thumb = PixelTextGenerator.renderPreview(patternData, 200);
    preview.innerHTML = `<img src="${thumb}" alt="${text}" style="image-rendering:pixelated; max-width:100%; max-height:200px; cursor:pointer;" title="点击使用此图案">`;
    preview.querySelector('img').addEventListener('click', () => {
      this._loadPattern(patternData);
      document.getElementById('galleryModal').classList.add('hidden');
    });

    // Show info
    const info = document.getElementById('ptInfo');
    info.innerHTML = `<b>${patternData.width} × ${patternData.rows.length}</b> 珠 · 点击预览图使用`;

    trackEvent('pixel_text', { text: text.slice(0, 5), size: fontSize });
  }

  _getGallerySource() {
    if (typeof PATTERN_GALLERY !== 'undefined') {
      if (this._galleryMode === 'pattern') return PATTERN_GALLERY.filter(c => c.id !== 'famous-ip' && c.id !== 'sbti-pixel');
      if (this._galleryMode === 'famous-ip') return PATTERN_GALLERY.filter(c => c.id === 'famous-ip');
      if (this._galleryMode === 'sbti') return PATTERN_GALLERY.filter(c => c.id === 'sbti-pixel');
    }
    if (typeof GALLERY_DATA !== 'undefined') return GALLERY_DATA;
    return [];
  }

  _isPatternMode() {
    return this._galleryMode === 'pattern' || this._galleryMode === 'famous-ip' || this._galleryMode === 'sbti';
  }

  _buildGalleryTabs() {
    const tabs = document.getElementById('galleryTabs');
    if (tabs.children.length) return;
    const source = this._getGallerySource();
    // Hide tabs when there's only one category (e.g. famous-ip, sbti)
    if (source.length <= 1) { tabs.classList.add('hidden'); }
    else { tabs.classList.remove('hidden'); }
    source.forEach((cat, i) => {
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

  _renderGalleryGrid(catIdx) {
    const grid = document.getElementById('galleryGrid');
    const source = this._getGallerySource();
    const cat = source[catIdx];
    if (!cat) return;

    if (this._isPatternMode()) {
      grid.innerHTML = cat.items.map((item, i) => {
        const thumb = item.image ? item.image : renderPatternThumb(item, 80);
        const cls = item.image ? 'gallery-item gallery-pattern-item gallery-illust-item' : 'gallery-item gallery-pattern-item';
        return `<div class="${cls}" data-cat="${catIdx}" data-idx="${i}"><img src="${thumb}" alt="${item.name}"><span>${item.name}</span><small>${item.width}x${item.rows.length}</small></div>`;
      }).join('');
      grid.querySelectorAll('.gallery-item').forEach(el => {
        el.addEventListener('click', () => {
          const ci = parseInt(el.dataset.cat);
          const ii = parseInt(el.dataset.idx);
          const item = source[ci].items[ii];
          if (item.image) {
            this._loadImageFromUrl(item.image, item.name, 'gallery', item);
          } else {
            this._loadPattern(item);
          }
          document.getElementById('galleryModal').classList.add('hidden');
        });
      });
    } else {
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
          const item = source[ci].items[ii];
          this._loadImageFromUrl(item.url, item.name);
          document.getElementById('galleryModal').classList.add('hidden');
        });
      });
    }
  }

  _loadPattern(patternData) {
    this._galleryTitlePattern = null;
    const brand = document.getElementById('brandSelect').value;
    const palette = BEAD_PALETTES[brand].colors;
    this.pattern = decodePattern(patternData, palette);
    this.bgCode = this._detectBackgroundCode(this.pattern);
    this.image = null;
    this.croppedImage = null;
    this._imageDataUrl = '';
    this._restoreOriginalDataUrl = '';
    this._restoredSource = false;
    this._resetRestorePreviewState();
    this._setRestoreStatus('');
    this._syncRestoreUI();
    this._setLandingShowcaseHidden(true);
    document.querySelector('.pattern-container').classList.add('has-pattern');
    this._fitAndDraw();
    this._renderLegend();
    this._renderStats();
    document.getElementById('exportBtn').disabled = false;
    document.getElementById('exportPdfBtn').disabled = false;
    document.getElementById('compareBtn').classList.add('hidden');
    document.getElementById('fullscreenBtn').classList.remove('hidden');
    trackEvent('load_pattern', { name: patternData.name, w: patternData.width });
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

    if (this.auth.needsBeans()) {
      if (this.authUI && this.authUI.showNoBeansModal) this.authUI.showNoBeansModal(this.auth.beans);
      return;
    }

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
      this._applySbtiTitleOverlay(adjustedImage, palette);

      // Auto-detect background color from the outer edge only.
      // Using the most common color hides large single-color subjects like emoji fills.
      this.bgCode = this._detectBackgroundCode(this.pattern);

      this._setLandingShowcaseHidden(true);
      document.querySelector('.pattern-container').classList.add('has-pattern');
      this._fitAndDraw();
      this._renderLegend();
      this._renderStats();
      document.getElementById('exportBtn').disabled = false;
      document.getElementById('exportPdfBtn').disabled = false;
      document.getElementById('compareBtn').classList.remove('hidden');
      document.getElementById('fullscreenBtn').classList.remove('hidden');

      // Start 1-min timer to prompt registration (only if not logged in)
      if (!this.auth.isLoggedIn) {
        this.auth.startPatternTimer(() => {
          if (this.authUI) this.authUI.showAuthModal('注册即可保存作品，新用户赠送 10 个豆子', true);
        });
      }

      // Consume one use
      if (!this.isPro) UsageLimiter.consume();
      this._updateUsageUI();

      // Consume a bean for logged-in users
      if (this.auth.isLoggedIn) {
        this.auth.consumeBean('生成拼豆图案').then(res => {
          if (res && res.need_recharge && this.authUI && this.authUI.showNoBeansModal) {
            this.authUI.showNoBeansModal(res.beans);
          }
          if (res && res.error) {
            showToast(res.error, 'error');
          }
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

  _detectBackgroundCode(pattern) {
    if (!pattern) return null;

    const { grid, width: W, height: H } = pattern;
    const edgeCounts = {};
    let perimeter = 0;

    const visit = (x, y) => {
      perimeter++;
      const c = grid[y] && grid[y][x];
      if (!c) return;
      edgeCounts[c.code] = (edgeCounts[c.code] || 0) + 1;
    };

    for (let x = 0; x < W; x++) {
      visit(x, 0);
      if (H > 1) visit(x, H - 1);
    }
    for (let y = 1; y < H - 1; y++) {
      visit(0, y);
      if (W > 1) visit(W - 1, y);
    }

    const best = Object.entries(edgeCounts).sort((a, b) => b[1] - a[1])[0];
    if (!best || perimeter === 0) return null;

    const [code, count] = best;
    return count / perimeter >= 0.35 ? code : null;
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

    // Keep the board background pure white so empty cells match the final pegboard look.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(AXIS_M, AXIS_M, W * CELL, H * CELL);

    // ── Cells ──
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = grid[y][x];
        if (!c) continue;
        if (this.hideBg && this.bgCode && c.code === this.bgCode) continue;
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
      // Major grid every 5
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.2;
      for (let x = 5; x <= W; x += 5) {
        const px = AXIS_M + x * CELL;
        ctx.beginPath(); ctx.moveTo(px, AXIS_M); ctx.lineTo(px, AXIS_M + H * CELL); ctx.stroke();
      }
      for (let y = 5; y <= H; y += 5) {
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
          if (this.hideBg && this.bgCode && c.code === this.bgCode) continue;
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

    container.innerHTML = sorted.map(([code, count]) => {
      const c = palette.find(p => p.code === code);
      if (!c) return '';
      return `<div class="legend-item">
        <div class="legend-color" style="background:${c.hex}"></div>
        <span class="legend-code">${c.code}</span>
        <span class="legend-count">${count}颗</span>
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
        if (this.hideBg && this.bgCode && c.code === this.bgCode) continue;
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

    // Major grid every 5
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.2;
    for (let x = 5; x <= W; x += 5) { ctx.beginPath(); ctx.moveTo(AXIS+x*CELL, AXIS); ctx.lineTo(AXIS+x*CELL, AXIS+H*CELL); ctx.stroke(); }
    for (let y = 5; y <= H; y += 5) { ctx.beginPath(); ctx.moveTo(AXIS, AXIS+y*CELL); ctx.lineTo(AXIS+W*CELL, AXIS+y*CELL); ctx.stroke(); }

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

  /* ═══════════ Fullscreen ═══════════ */

  _toggleFullscreen() {
    const container = document.querySelector('.pattern-container');
    const isFs = document.fullscreenElement || document.webkitFullscreenElement;
    if (isFs) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      return;
    }
    if (container.classList.contains('fake-fullscreen')) {
      container.classList.remove('fake-fullscreen');
      document.getElementById('fullscreenBtn').textContent = '⛶';
      this._fitAndDraw();
      return;
    }
    // Try native fullscreen with timeout fallback
    const tryNative = container.requestFullscreen || container.webkitRequestFullscreen;
    if (tryNative) {
      const timer = setTimeout(() => {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) this._fakeFull(container);
      }, 300);
      const p = tryNative.call(container);
      if (p && p.then) p.catch(() => { clearTimeout(timer); this._fakeFull(container); });
    } else {
      this._fakeFull(container);
    }
  }

  _fakeFull(container) {
    container.classList.add('fake-fullscreen');
    document.getElementById('fullscreenBtn').textContent = '✕';
    this._fitAndDraw();
  }

  _onFullscreenChange() {
    const isFs = document.fullscreenElement || document.webkitFullscreenElement;
    document.getElementById('fullscreenBtn').textContent = isFs ? '✕' : '⛶';
    // ResizeObserver will auto-trigger _fitAndDraw
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
            if (this.hideBg && this.bgCode && c.code === this.bgCode) continue;
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
      // Color swatch
      const rgb = this.converter.hexToRgb(c.hex);
      doc.setFillColor(rgb.r, rgb.g, rgb.b);
      doc.rect(margin, listY - 2.5, 4, 4, 'F');
      doc.setDrawColor(180, 180, 180);
      doc.rect(margin, listY - 2.5, 4, 4, 'S');
      doc.setTextColor(0, 0, 0);
      doc.text(`${code}  ${count}颗`, margin + 6, listY);
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
