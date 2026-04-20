/**
 * BeadConverter — image → bead-pattern conversion engine.
 *
 * Pipeline:
 *   1. Resize image to target grid dimensions (pixelation)
 *   2. Convert each pixel RGB → CIE-Lab
 *   3. Match to nearest bead color using Delta-E (CIEDE2000)
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

  deltaE76(a, b) {
    return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);
  }

  deltaE2000(a, b) {
    const [l1, a1, b1] = a;
    const [l2, a2, b2] = b;
    const c1 = Math.hypot(a1, b1);
    const c2 = Math.hypot(a2, b2);
    const avgC = (c1 + c2) / 2;
    const pow25To7 = 6103515625;
    const g = 0.5 * (1 - Math.sqrt((avgC ** 7) / ((avgC ** 7) + pow25To7)));
    const a1p = (1 + g) * a1;
    const a2p = (1 + g) * a2;
    const c1p = Math.hypot(a1p, b1);
    const c2p = Math.hypot(a2p, b2);
    const avgCp = (c1p + c2p) / 2;
    const h1p = (Math.atan2(b1, a1p) * 180 / Math.PI + 360) % 360;
    const h2p = (Math.atan2(b2, a2p) * 180 / Math.PI + 360) % 360;

    const deltaLp = l2 - l1;
    const deltaCp = c2p - c1p;

    let deltaHpDeg = 0;
    if (c1p * c2p !== 0) {
      deltaHpDeg = h2p - h1p;
      if (deltaHpDeg > 180) deltaHpDeg -= 360;
      else if (deltaHpDeg < -180) deltaHpDeg += 360;
    }
    const deltaHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((deltaHpDeg * Math.PI / 180) / 2);

    const avgLp = (l1 + l2) / 2;
    let avgHp = h1p + h2p;
    if (c1p * c2p === 0) {
      avgHp = h1p + h2p;
    } else if (Math.abs(h1p - h2p) > 180) {
      avgHp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
    } else {
      avgHp = (h1p + h2p) / 2;
    }

    const avgHpRad = avgHp * Math.PI / 180;
    const t = 1
      - 0.17 * Math.cos(avgHpRad - Math.PI / 6)
      + 0.24 * Math.cos(2 * avgHpRad)
      + 0.32 * Math.cos(3 * avgHpRad + Math.PI / 30)
      - 0.20 * Math.cos(4 * avgHpRad - 63 * Math.PI / 180);
    const deltaTheta = 30 * Math.exp(-(((avgHp - 275) / 25) ** 2));
    const rc = 2 * Math.sqrt((avgCp ** 7) / ((avgCp ** 7) + pow25To7));
    const sl = 1 + (0.015 * ((avgLp - 50) ** 2)) / Math.sqrt(20 + ((avgLp - 50) ** 2));
    const sc = 1 + 0.045 * avgCp;
    const sh = 1 + 0.015 * avgCp * t;
    const rt = -Math.sin(2 * deltaTheta * Math.PI / 180) * rc;

    const lTerm = deltaLp / sl;
    const cTerm = deltaCp / sc;
    const hTerm = deltaHp / sh;
    return Math.sqrt(
      lTerm * lTerm +
      cTerm * cTerm +
      hTerm * hTerm +
      rt * cTerm * hTerm
    );
  }

  matteToWhite(r, g, b, a) {
    const alpha = a / 255;
    return [
      Math.round(r * alpha + 255 * (1 - alpha)),
      Math.round(g * alpha + 255 * (1 - alpha)),
      Math.round(b * alpha + 255 * (1 - alpha)),
    ];
  }

  _sampleWeight(samples) {
    let total = 0;
    for (const sample of samples) total += sample.weight;
    return total;
  }

  _weightedAverageRgb(samples) {
    const total = this._sampleWeight(samples);
    if (!total) return null;

    let r = 0, g = 0, b = 0;
    for (const sample of samples) {
      r += sample.rgb[0] * sample.weight;
      g += sample.rgb[1] * sample.weight;
      b += sample.rgb[2] * sample.weight;
    }
    return [Math.round(r / total), Math.round(g / total), Math.round(b / total)];
  }

  _weightedAverageLab(samples) {
    const total = this._sampleWeight(samples);
    if (!total) return null;

    let l = 0, a = 0, b = 0;
    for (const sample of samples) {
      l += sample.lab[0] * sample.weight;
      a += sample.lab[1] * sample.weight;
      b += sample.lab[2] * sample.weight;
    }
    return [l / total, a / total, b / total];
  }

  _centerScore(samples) {
    const total = this._sampleWeight(samples);
    if (!total) return 0;

    let score = 0;
    for (const sample of samples) score += sample.weight * sample.center;
    return score / total;
  }

  _clusterCellSamples(samples, threshold = 18) {
    const clusters = [];

    for (const sample of samples) {
      let best = null;
      let bestDistance = threshold;
      for (const cluster of clusters) {
        const distance = this.deltaE76(sample.lab, cluster.seedLab);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = cluster;
        }
      }

      if (!best) {
        best = { seedLab: sample.lab, samples: [] };
        clusters.push(best);
      }
      best.samples.push(sample);
    }

    return clusters.map(cluster => {
      const rgb = this._weightedAverageRgb(cluster.samples);
      return {
        samples: cluster.samples,
        rgb,
        lab: this.rgbToLab(rgb[0], rgb[1], rgb[2]),
        weight: this._sampleWeight(cluster.samples),
      };
    });
  }

  _sampleCellRepresentative(originalData, sourceWidth, sourceHeight, gridWidth, gridHeight, cellX, cellY) {
    const x0 = cellX * sourceWidth / gridWidth;
    const x1 = (cellX + 1) * sourceWidth / gridWidth;
    const y0 = cellY * sourceHeight / gridHeight;
    const y1 = (cellY + 1) * sourceHeight / gridHeight;
    const cellSpan = Math.max(x1 - x0, y1 - y0);
    const sampleGrid = cellSpan >= 12 ? 6 : (cellSpan >= 8 ? 5 : (cellSpan >= 4 ? 4 : 3));
    const samples = [];

    for (let sy = 0; sy < sampleGrid; sy++) {
      const fy = y0 + (sy + 0.5) * (y1 - y0) / sampleGrid;
      const py = Math.min(sourceHeight - 1, Math.max(0, Math.floor(fy)));
      for (let sx = 0; sx < sampleGrid; sx++) {
        const fx = x0 + (sx + 0.5) * (x1 - x0) / sampleGrid;
        const px = Math.min(sourceWidth - 1, Math.max(0, Math.floor(fx)));
        const index = (py * sourceWidth + px) * 4;
        const alpha = originalData[index + 3];
        if (alpha < 24) continue;

        const rgb = this.matteToWhite(
          originalData[index],
          originalData[index + 1],
          originalData[index + 2],
          alpha,
        );
        const dx = (sx + 0.5) / sampleGrid - 0.5;
        const dy = (sy + 0.5) / sampleGrid - 0.5;
        const center = Math.max(0, 1 - Math.hypot(dx, dy) / 0.7071067811865476);
        samples.push({
          rgb,
          lab: this.rgbToLab(rgb[0], rgb[1], rgb[2]),
          weight: 0.7 + 0.6 * center,
          center,
        });
      }
    }

    if (!samples.length) return null;

    const totalWeight = this._sampleWeight(samples);
    const avgRgb = this._weightedAverageRgb(samples);
    const avgLab = this.rgbToLab(avgRgb[0], avgRgb[1], avgRgb[2]);
    const avgChroma = Math.hypot(avgLab[1], avgLab[2]);
    const clusters = this._clusterCellSamples(samples);
    clusters.sort((a, b) => b.weight - a.weight);
    const dominant = clusters[0];
    const dominantShare = dominant.weight / totalWeight;
    const dominantChroma = Math.hypot(dominant.lab[1], dominant.lab[2]);
    const allowNeutralDarkGlint = (
      dominantShare <= 0.42 ||
      (dominantShare <= 0.78 && avgLab[0] <= 45 && avgChroma <= 6)
    );

    // Preserve thin strokes and text on white backgrounds.
    // Without this, small green or dark glyph fragments get averaged into white.
    if (
      dominant.lab[0] >= 92 &&
      dominantChroma <= 8 &&
      avgLab[0] >= 82 &&
      dominant.lab[0] - avgLab[0] <= 16
    ) {
      let strokeCluster = null;
      let bestScore = -Infinity;
      for (const cluster of clusters.slice(1)) {
        const share = cluster.weight / totalWeight;
        const centerScore = this._centerScore(cluster.samples);
        const clusterChroma = Math.hypot(cluster.lab[1], cluster.lab[2]);
        const contrast = this.deltaE76(cluster.lab, dominant.lab);
        const darkness = dominant.lab[0] - cluster.lab[0];
        const score = contrast * share * (0.6 + centerScore);
        const sampleCount = cluster.samples.length;
        const centeredStroke = (
          share >= 0.18 &&
          centerScore >= 0.22 &&
          contrast >= 18 &&
          (clusterChroma >= 12 || darkness >= 12)
        );
        const thinHighContrastStroke = (
          (share >= 0.12 || sampleCount >= 3) &&
          contrast >= 24 &&
          (clusterChroma >= 18 || darkness >= 18)
        );
        if (
          (centeredStroke || thinHighContrastStroke) &&
          score > bestScore
        ) {
          bestScore = score;
          strokeCluster = cluster;
        }
      }
      if (strokeCluster) return strokeCluster.rgb;
    }

    // Preserve tiny white highlights inside dark regions, such as eye glints.
    // Without this, a small bright cluster gets swallowed by the surrounding dark fill.
    if (dominant.lab[0] <= 40 && dominantChroma <= 24 && allowNeutralDarkGlint) {
      let highlightCluster = null;
      let bestScore = -Infinity;
      for (const cluster of clusters.slice(1)) {
        const share = cluster.weight / totalWeight;
        const centerScore = this._centerScore(cluster.samples);
        const clusterChroma = Math.hypot(cluster.lab[1], cluster.lab[2]);
        const contrast = this.deltaE76(cluster.lab, dominant.lab);
        const lightnessGain = cluster.lab[0] - dominant.lab[0];
        const sampleCount = cluster.samples.length;
        const score = contrast * (share + sampleCount * 0.035) * (0.45 + centerScore);
        const brightNeutralHighlight = (
          (share >= 0.11 || sampleCount >= 2) &&
          share <= 0.24 &&
          centerScore >= 0.16 &&
          cluster.lab[0] >= 82 &&
          clusterChroma <= 14 &&
          lightnessGain >= 38 &&
          contrast >= 28
        );
        const crispSpecularHighlight = (
          (share >= 0.08 || sampleCount >= 2) &&
          share <= 0.2 &&
          centerScore >= 0.08 &&
          cluster.lab[0] >= 88 &&
          clusterChroma <= 10 &&
          lightnessGain >= 44 &&
          contrast >= 34
        );
        if (
          (brightNeutralHighlight || crispSpecularHighlight) &&
          score > bestScore
        ) {
          bestScore = score;
          highlightCluster = cluster;
        }
      }
      if (highlightCluster) {
        const brightSamples = highlightCluster.samples.filter(sample => (
          sample.lab[0] >= Math.max(84, highlightCluster.lab[0] - 6) &&
          Math.hypot(sample.lab[1], sample.lab[2]) <= 16
        ));
        if (brightSamples.length) {
          return this._weightedAverageRgb(brightSamples);
        }
        return highlightCluster.rgb;
      }
    }

    const darkSamples = samples.filter(sample => sample.lab[0] + 14 < avgLab[0]);
    if (darkSamples.length) {
      const darkWeight = this._sampleWeight(darkSamples);
      const darkLab = this._weightedAverageLab(darkSamples);
      if (
        darkWeight / totalWeight >= 0.22 &&
        this._centerScore(darkSamples) >= 0.42 &&
        avgLab[0] - darkLab[0] >= 18
      ) {
        return this._weightedAverageRgb(darkSamples);
      }
    }

    const vividSamples = samples.filter(sample => Math.hypot(sample.lab[1], sample.lab[2]) > avgChroma + 10);
    if (vividSamples.length) {
      const vividWeight = this._sampleWeight(vividSamples);
      const vividLab = this._weightedAverageLab(vividSamples);
      if (
        vividWeight / totalWeight >= 0.22 &&
        this._centerScore(vividSamples) >= 0.42 &&
        Math.hypot(vividLab[1], vividLab[2]) - avgChroma >= 12 &&
        this.deltaE76(vividLab, avgLab) >= 18
      ) {
        return this._weightedAverageRgb(vividSamples);
      }
    }

    if (dominant && dominant.weight / totalWeight >= 0.58 && this.deltaE76(dominant.lab, avgLab) <= 10) {
      return dominant.rgb;
    }

    return avgRgb;
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
      const d = this.deltaE2000(lab, c.lab);
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

    // Down-sample via off-screen canvas
    const cvs = document.createElement('canvas');
    cvs.width = gridWidth;
    cvs.height = gridHeight;
    const ctx = cvs.getContext('2d', { willReadFrequently: true });

    // Smooth pass: better color gradients
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, gridWidth, gridHeight);
    const smData = new Uint8ClampedArray(ctx.getImageData(0, 0, gridWidth, gridHeight).data);

    // NN pass: accurate alpha (edges) — smooth blurs alpha near transparency boundaries
    ctx.clearRect(0, 0, gridWidth, gridHeight);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0, gridWidth, gridHeight);
    const nnData = ctx.getImageData(0, 0, gridWidth, gridHeight).data;

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = image.width;
    sourceCanvas.height = image.height;
    const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    sourceCtx.drawImage(image, 0, 0, image.width, image.height);
    const originalData = sourceCtx.getImageData(0, 0, image.width, image.height).data;

    // Build a detail-preserving representative color for each output cell.
    const sourceData = new Uint8ClampedArray(smData.length);
    for (let y = 0; y < gridHeight; y++) {
      for (let x = 0; x < gridWidth; x++) {
        const j = (y * gridWidth + x) * 4;
        const smoothRgb = this.matteToWhite(smData[j], smData[j+1], smData[j+2], smData[j+3]);
        const nnRgb = this.matteToWhite(nnData[j], nnData[j+1], nnData[j+2], nnData[j+3]);

        const effAlpha = Math.max(nnData[j+3], smData[j+3]);
        if (effAlpha < 24) {
          sourceData[j+3] = 0;
          continue;
        }

        const smoothLab = this.rgbToLab(smoothRgb[0], smoothRgb[1], smoothRgb[2]);
        const nnLab = this.rgbToLab(nnRgb[0], nnRgb[1], nnRgb[2]);
        const detailDelta = this.deltaE76(smoothLab, nnLab);
        const smoothChroma = Math.hypot(smoothLab[1], smoothLab[2]);
        const nnChroma = Math.hypot(nnLab[1], nnLab[2]);
        const preferNn = effAlpha >= 220 && detailDelta >= 18 && (
          nnLab[0] + 10 < smoothLab[0] ||
          nnChroma > smoothChroma + 12
        );
        const preferBrightNn = effAlpha >= 220 && detailDelta >= 20 && (
          nnLab[0] >= smoothLab[0] + 22 &&
          nnLab[0] >= 88 &&
          nnChroma <= 10
        );

        let chosenRgb = (preferNn || preferBrightNn) ? nnRgb : smoothRgb;
        const shouldRefine = effAlpha >= 180 && (
          detailDelta >= 4 ||
          smoothLab[0] <= 45 ||
          nnLab[0] <= 45
        );
        if (shouldRefine && !preferBrightNn) {
          const refinedRgb = this._sampleCellRepresentative(
            originalData,
            image.width,
            image.height,
            gridWidth,
            gridHeight,
            x,
            y,
          );
          if (refinedRgb) chosenRgb = refinedRgb;
        }

        sourceData[j] = chosenRgb[0];
        sourceData[j+1] = chosenRgb[1];
        sourceData[j+2] = chosenRgb[2];
        sourceData[j+3] = 255;
      }
    }

    // ── Pre-cluster similar source colours (leader algorithm in Lab) ───
    // Down-sampling introduces sub-pixel RGB drift: two regions that are
    // visually identical (e.g. both eyes of a character) may differ by a
    // few RGB levels.  Clustering merges them so they map to the same bead.
    const _uniqueRgb = new Map();                 // packed-RGB → Lab
    for (let j = 0; j < sourceData.length; j += 4) {
      if (sourceData[j+3] === 0) continue;
      const pk = (sourceData[j] << 16) | (sourceData[j+1] << 8) | sourceData[j+2];
      if (!_uniqueRgb.has(pk))
        _uniqueRgb.set(pk, this.rgbToLab(sourceData[j], sourceData[j+1], sourceData[j+2]));
    }
    const CLUSTER_DE = 8;                         // ΔE merge threshold
    const _leaders = [];                          // [{lab, pk}]
    const _clusterMap = new Map();                // packed-RGB → leader pk
    for (const [pk, lab] of _uniqueRgb) {
      let matched = null;
      for (const ld of _leaders) {
        if (this.deltaE76(lab, ld.lab) < CLUSTER_DE) { matched = ld; break; }
      }
      if (matched) { _clusterMap.set(pk, matched.pk); }
      else         { _leaders.push({ lab, pk }); _clusterMap.set(pk, pk); }
    }

    // First pass — map every pixel to nearest bead colour
    const grid = [];
    const counts = {};

    for (let y = 0; y < gridHeight; y++) {
      const row = [];
      for (let x = 0; x < gridWidth; x++) {
        const i = (y * gridWidth + x) * 4;
        // Use the MORE opaque of NN and smooth alpha — avoids NN sampling
        // a single transparent edge pixel and blanking a mostly-opaque cell.
        const effAlpha = Math.max(nnData[i+3], smData[i+3]);
        if (effAlpha < 24) { row.push(null); continue; }   // truly transparent → empty
        // Use clustered representative colour for matching
        const pk = (sourceData[i] << 16) | (sourceData[i+1] << 8) | sourceData[i+2];
        const rk = _clusterMap.get(pk) ?? pk;
        const c = this.findNearest((rk>>16)&0xFF, (rk>>8)&0xFF, rk&0xFF, palette);
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
          const d = this.deltaE2000(cand.lab, sel.lab);
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
