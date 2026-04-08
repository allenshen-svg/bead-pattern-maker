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

    // Down-sample via off-screen canvas — use nearest-neighbor for clean edges
    const cvs = document.createElement('canvas');
    cvs.width = gridWidth;
    cvs.height = gridHeight;
    const ctx = cvs.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0, gridWidth, gridHeight);

    const imgData = ctx.getImageData(0, 0, gridWidth, gridHeight);
    const px = imgData.data;

    // First pass — map every pixel to nearest bead colour
    const grid = [];
    const counts = {};

    for (let y = 0; y < gridHeight; y++) {
      const row = [];
      for (let x = 0; x < gridWidth; x++) {
        const i = (y * gridWidth + x) * 4;
        if (px[i+3] < 128) { row.push(null); continue; }   // transparent → empty
        const c = this.findNearest(px[i], px[i+1], px[i+2], palette);
        row.push(c);
        counts[c.code] = (counts[c.code] || 0) + 1;
      }
      grid.push(row);
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
    // Select N colors using frequency + color diversity (greedy max-min distance)
    // 1. Build color info with Lab values
    const colorInfo = Object.entries(counts).map(([code, cnt]) => {
      const c = palette.find(p => p.code === code);
      return { code, count: cnt, lab: c ? this.rgbToLab(c.rgb.r, c.rgb.g, c.rgb.b) : [0,0,0] };
    });

    // 2. Start with the most frequent color
    const selected = [];
    const remaining = [...colorInfo];
    remaining.sort((a, b) => b.count - a.count);
    selected.push(remaining.shift());

    // 3. Greedily pick next color that maximizes: diversity_score * frequency_weight
    while (selected.length < maxN && remaining.length > 0) {
      let bestIdx = 0, bestScore = -1;
      for (let i = 0; i < remaining.length; i++) {
        const cand = remaining[i];
        // Min distance to any already-selected color
        let minDist = Infinity;
        for (const sel of selected) {
          const d = this.deltaE(cand.lab, sel.lab);
          if (d < minDist) minDist = d;
        }
        // Score = distance * sqrt(frequency) — balances diversity and importance
        const score = minDist * Math.sqrt(cand.count);
        if (score > bestScore) { bestScore = score; bestIdx = i; }
      }
      selected.push(remaining.splice(bestIdx, 1)[0]);
    }

    const keep = new Set(selected.map(s => s.code));
    const kept = palette.filter(c => keep.has(c.code));

    // Clear cache for reduced palette lookups
    this._labCache.clear();

    // Remap non-kept colors to nearest kept color
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = grid[y][x];
        if (!c) continue;
        if (keep.has(c.code)) continue;
        grid[y][x] = this.findNearest(c.rgb.r, c.rgb.g, c.rgb.b, kept);
      }
    }
  }
}
