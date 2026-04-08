/**
 * BeadConverter — image → bead-pattern conversion engine.
 *
 * Pipeline:
 *   1. Resize image to target grid dimensions (pixelation)
 *   2. Convert each pixel RGB → CIE-Lab
 *   3. Match to nearest bead color using Delta-E (CIE76)
 *   4. Optionally reduce to max N colors
 */
class BeadConverter {
  constructor() {
    this._labCache = new Map();          // pixel RGB → nearest color cache
    this._paletteLab = [];               // palette pre-computed Lab values
  }

  /* ── Colour-space helpers ─────────────────────────────── */

  hexToRgb(hex) {
    const v = parseInt(hex.slice(1), 16);
    return { r: (v >> 16) & 0xFF, g: (v >> 8) & 0xFF, b: v & 0xFF };
  }

  rgbToLab(r, g, b) {
    // sRGB → linear
    let rr = r / 255, gg = g / 255, bb = b / 255;
    rr = rr > 0.04045 ? Math.pow((rr + 0.055) / 1.055, 2.4) : rr / 12.92;
    gg = gg > 0.04045 ? Math.pow((gg + 0.055) / 1.055, 2.4) : gg / 12.92;
    bb = bb > 0.04045 ? Math.pow((bb + 0.055) / 1.055, 2.4) : bb / 12.92;
    // linear RGB → XYZ (D65)
    let x = (rr * 0.4124564 + gg * 0.3575761 + bb * 0.1804375) / 0.95047;
    let y = (rr * 0.2126729 + gg * 0.7151522 + bb * 0.0721750);
    let z = (rr * 0.0193339 + gg * 0.1191920 + bb * 0.9503041) / 1.08883;
    // XYZ → Lab
    const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
    x = f(x); y = f(y); z = f(z);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }

  deltaE(a, b) {
    return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);
  }

  /* ── Palette preparation ──────────────────────────────── */

  preparePalette(colors) {
    return colors.map(c => {
      const rgb = this.hexToRgb(c.hex);
      return { ...c, rgb, lab: this.rgbToLab(rgb.r, rgb.g, rgb.b) };
    });
  }

  /* ── Nearest-colour lookup (with hash cache) ──────────── */

  findNearest(r, g, b, palette) {
    const key = (r << 16) | (g << 8) | b;
    if (this._labCache.has(key)) return this._labCache.get(key);

    const lab = this.rgbToLab(r, g, b);
    let best = null, bestD = Infinity;
    for (const c of palette) {
      const d = this.deltaE(lab, c.lab);
      if (d < bestD) { bestD = d; best = c; }
    }
    this._labCache.set(key, best);
    return best;
  }

  /* ── Main conversion ──────────────────────────────────── */

  convert(image, gridWidth, rawPalette, maxColors = 0) {
    this._labCache.clear();
    const palette = this.preparePalette(rawPalette);

    // Determine grid dimensions keeping aspect ratio
    const aspect = image.height / image.width;
    const gridHeight = Math.round(gridWidth * aspect);

    // Down-sample via off-screen canvas (nearest-neighbor to detect outlines)
    const cvs = document.createElement('canvas');
    cvs.width = gridWidth;
    cvs.height = gridHeight;
    const ctx = cvs.getContext('2d');

    // Pass 1: nearest-neighbor to find dark outline pixels
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0, gridWidth, gridHeight);
    const nnData = ctx.getImageData(0, 0, gridWidth, gridHeight).data;

    // Pass 2: smooth for non-outline areas (better gradients)
    ctx.clearRect(0, 0, gridWidth, gridHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, gridWidth, gridHeight);
    const smData = ctx.getImageData(0, 0, gridWidth, gridHeight).data;

    // Merge: use nearest-neighbor pixel if it's dark (outline), else smooth pixel
    const imgData = ctx.getImageData(0, 0, gridWidth, gridHeight);
    const px = imgData.data;
    for (let j = 0; j < px.length; j += 4) {
      const nnBri = (nnData[j] * 299 + nnData[j+1] * 587 + nnData[j+2] * 114) / 1000;
      if (nnBri < 80) {
        px[j] = nnData[j]; px[j+1] = nnData[j+1]; px[j+2] = nnData[j+2]; px[j+3] = nnData[j+3];
      } else {
        px[j] = smData[j]; px[j+1] = smData[j+1]; px[j+2] = smData[j+2]; px[j+3] = smData[j+3];
      }
    }

    // First pass — map every pixel to nearest bead colour with error diffusion
    const grid = [];
    const counts = {};
    // Error diffusion buffers (current row + next row)
    let errCurR = new Float32Array(gridWidth), errCurG = new Float32Array(gridWidth), errCurB = new Float32Array(gridWidth);
    let errNxtR = new Float32Array(gridWidth), errNxtG = new Float32Array(gridWidth), errNxtB = new Float32Array(gridWidth);

    for (let y = 0; y < gridHeight; y++) {
      const row = [];
      for (let x = 0; x < gridWidth; x++) {
        const i = (y * gridWidth + x) * 4;
        if (px[i+3] < 128) { row.push(null); continue; }   // transparent → empty
        // Skip error diffusion for dark pixels (outlines) to prevent color bleeding
        const origBri = (px[i] * 299 + px[i+1] * 587 + px[i+2] * 114) / 1000;
        const isDark = origBri < 80;
        const r = isDark ? px[i]   : Math.max(0, Math.min(255, Math.round(px[i]   + errCurR[x])));
        const g = isDark ? px[i+1] : Math.max(0, Math.min(255, Math.round(px[i+1] + errCurG[x])));
        const b = isDark ? px[i+2] : Math.max(0, Math.min(255, Math.round(px[i+2] + errCurB[x])));
        const c = this.findNearest(r, g, b, palette);
        row.push(c);
        counts[c.code] = (counts[c.code] || 0) + 1;
        // Distribute quantization error (Floyd-Steinberg)
        const er = r - c.rgb.r, eg = g - c.rgb.g, eb = b - c.rgb.b;
        if (x + 1 < gridWidth)  { errCurR[x+1] += er * 7/16; errCurG[x+1] += eg * 7/16; errCurB[x+1] += eb * 7/16; }
        if (y + 1 < gridHeight) {
          if (x - 1 >= 0)      { errNxtR[x-1] += er * 3/16; errNxtG[x-1] += eg * 3/16; errNxtB[x-1] += eb * 3/16; }
                                  errNxtR[x]   += er * 5/16; errNxtG[x]   += eg * 5/16; errNxtB[x]   += eb * 5/16;
          if (x + 1 < gridWidth){ errNxtR[x+1] += er * 1/16; errNxtG[x+1] += eg * 1/16; errNxtB[x+1] += eb * 1/16; }
        }
      }
      grid.push(row);
      // Swap rows
      errCurR = errNxtR; errCurG = errNxtG; errCurB = errNxtB;
      errNxtR = new Float32Array(gridWidth); errNxtG = new Float32Array(gridWidth); errNxtB = new Float32Array(gridWidth);
    }

    // Optional colour reduction
    if (maxColors > 0 && Object.keys(counts).length > maxColors) {
      this._reduceColors(grid, gridWidth, gridHeight, palette, counts, maxColors);
    }

    // Rebuild counts after possible reduction
    const finalCounts = {};
    let total = 0;
    for (const row of grid) {
      for (const c of row) {
        if (!c) continue;
        finalCounts[c.code] = (finalCounts[c.code] || 0) + 1;
        total++;
      }
    }

    return {
      grid,
      width: gridWidth,
      height: gridHeight,
      colorCounts: finalCounts,
      totalBeads: total,
      uniqueColors: Object.keys(finalCounts).length,
    };
  }

  /* ── Reduce to N most-used colours ────────────────────── */

  _reduceColors(grid, w, h, palette, counts, maxN) {
    // Keep top-N colours by frequency, but also weight by visual importance
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const keep = new Set(sorted.slice(0, maxN).map(e => e[0]));
    const kept = palette.filter(c => keep.has(c.code));

    // Clear cache for reduced palette lookups
    this._labCache.clear();

    // Remap with Floyd-Steinberg error diffusion for better visual fidelity
    // Build Lab error buffer
    const errR = Array.from({length: h}, () => new Float32Array(w));
    const errG = Array.from({length: h}, () => new Float32Array(w));
    const errB = Array.from({length: h}, () => new Float32Array(w));

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = grid[y][x];
        if (!c) continue;
        if (keep.has(c.code)) continue;
        // Skip error diffusion for dark pixels (outlines)
        const bri = (c.rgb.r * 299 + c.rgb.g * 587 + c.rgb.b * 114) / 1000;
        const r = bri < 80 ? c.rgb.r : Math.max(0, Math.min(255, Math.round(c.rgb.r + errR[y][x])));
        const g = bri < 80 ? c.rgb.g : Math.max(0, Math.min(255, Math.round(c.rgb.g + errG[y][x])));
        const b = bri < 80 ? c.rgb.b : Math.max(0, Math.min(255, Math.round(c.rgb.b + errB[y][x])));
        const nc = this.findNearest(r, g, b, kept);
        grid[y][x] = nc;
        // Compute quantization error
        const er = r - nc.rgb.r, eg = g - nc.rgb.g, eb = b - nc.rgb.b;
        // Distribute error to neighbors (Floyd-Steinberg)
        if (x + 1 < w)           { errR[y][x+1]   += er * 7/16; errG[y][x+1]   += eg * 7/16; errB[y][x+1]   += eb * 7/16; }
        if (y + 1 < h) {
          if (x - 1 >= 0)        { errR[y+1][x-1] += er * 3/16; errG[y+1][x-1] += eg * 3/16; errB[y+1][x-1] += eb * 3/16; }
                                   errR[y+1][x]   += er * 5/16; errG[y+1][x]   += eg * 5/16; errB[y+1][x]   += eb * 5/16;
          if (x + 1 < w)        { errR[y+1][x+1] += er * 1/16; errG[y+1][x+1] += eg * 1/16; errB[y+1][x+1] += eb * 1/16; }
        }
      }
    }
  }
}
