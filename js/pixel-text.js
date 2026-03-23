/**
 * 像素文字生成器 — 用 Canvas 渲染文字后采样为拼豆图案
 */
const PixelTextGenerator = {

  // Render text to a pixel grid using offscreen canvas
  generate(text, fontSize, fgColor, bgColor) {
    if (!text.trim()) return null;
    const cvs = document.createElement("canvas");
    const ctx = cvs.getContext("2d");

    // Measure text
    const font = `bold ${fontSize}px "Zpix", "WenQuanYi Bitmap Song", monospace`;
    ctx.font = font;
    const metrics = ctx.measureText(text);
    const textW = Math.ceil(metrics.width);
    const textH = fontSize;

    // Add 1px padding
    const pad = 1;
    cvs.width = textW + pad * 2;
    cvs.height = textH + pad * 2;

    // Fill background
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, cvs.width, cvs.height);

    // Draw text
    ctx.font = font;
    ctx.fillStyle = "#000000";
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText(text, pad, pad);

    // Sample pixels
    const imgData = ctx.getImageData(0, 0, cvs.width, cvs.height);
    const pixels = imgData.data;
    const w = cvs.width, h = cvs.height;

    // Build rows for pattern format
    const rows = [];
    for (let y = 0; y < h; y++) {
      const row = [];
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const r = pixels[idx], g = pixels[idx+1], b = pixels[idx+2];
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        row.push(brightness < 128 ? fgColor : bgColor);
      }
      rows.push(row.join(","));
    }

    // Trim empty rows from top and bottom
    let top = 0, bottom = rows.length - 1;
    const isEmpty = r => r.split(",").every(c => c === bgColor || c === ".");
    while (top < rows.length && isEmpty(rows[top])) top++;
    while (bottom > top && isEmpty(rows[bottom])) bottom--;

    // Trim empty columns from left and right
    const trimmedRows = rows.slice(top, bottom + 1);
    if (!trimmedRows.length) return null;

    const cols = trimmedRows[0].split(",").length;
    let left = cols, right = 0;
    trimmedRows.forEach(r => {
      const cells = r.split(",");
      for (let x = 0; x < cells.length; x++) {
        if (cells[x] !== bgColor && cells[x] !== ".") {
          if (x < left) left = x;
          if (x > right) right = x;
        }
      }
    });

    const finalRows = trimmedRows.map(r => {
      const cells = r.split(",");
      return cells.slice(left, right + 1).join(",");
    });

    const finalW = right - left + 1;
    return {
      name: text,
      width: finalW,
      rows: finalRows
    };
  },

  // Render a preview thumbnail
  renderPreview(patternData, size) {
    if (!patternData) return "";
    const cvs = document.createElement("canvas");
    const w = patternData.width, h = patternData.rows.length;
    const cell = Math.max(1, Math.floor(size / Math.max(w, h)));
    cvs.width = w * cell; cvs.height = h * cell;
    const ctx = cvs.getContext("2d");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, cvs.width, cvs.height);
    const colorMap = {};
    if (typeof BEAD_PALETTES !== "undefined") {
      BEAD_PALETTES.mard.colors.forEach(c => colorMap[c.code] = c.hex);
    }
    patternData.rows.forEach((rowStr, y) => {
      rowStr.split(",").forEach((code, x) => {
        const c = code.trim();
        if (c === "." || !c) return;
        ctx.fillStyle = colorMap[c] || "#000000";
        ctx.fillRect(x * cell, y * cell, cell, cell);
      });
    });
    return cvs.toDataURL("image/png");
  }
};
