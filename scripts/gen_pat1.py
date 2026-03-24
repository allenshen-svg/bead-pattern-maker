#!/usr/bin/env python3
"""Generate gallery-patterns.js with cute emoji-style patterns (Part 1: header + category 1)"""
import os

# Color shorthand map
C = {'B':'H23','W':'H19','P':'F2','R':'F17','K':'F8','Y':'A4','G':'B4','L':'C10','O':'A6','_':'.'}

def expand(rows, w):
    """Convert shorthand grid to full MARD codes"""
    out = []
    for r in rows:
        cells = []
        for ch in r:
            cells.append(C.get(ch, '.'))
        # pad or trim to width
        while len(cells) < w:
            cells.append('.')
        out.append(','.join(cells[:w]))
    return out

# ── Pattern definitions using shorthand ──
patterns = []

# Cat 1: 举手熊熊抱爱心 15x17
patterns.append(('举手熊熊抱爱心', 15, [
    '___BB_____BB___',
    '__BWWB___BWWB__',
    '__BWWB___BWWB__',
    '___BWBBBBBWB___',
    '___BWWWWWWWB___',
    '__BWWBWWWBWWB__',
    '__BWWWWBWWWWB__',
    '__BWWWWWWWWWB__',
    '___BWWWRWWWB___',
    '____BWWWWWB____',
    '_BB__BWWWB__BB_',
    'BRRB_BWWWB_BWB_',
    'BRRRB_BWB_BWWB_',
    'BRRRRBBWBBWWWB_',
    '_BRRRRBWBWWWB__',
    '__BRRRBBBWWB___',
    '___BBB___BBB___',
]))

# Cat 2: 开心跳跃小熊 13x15
patterns.append(('开心跳跃小熊', 13, [
    '__BB_____BB__',
    '_BWWB___BWWB_',
    '_BWWB___BWWB_',
    '__BWBBBBBWB__',
    '__BWWWWWWWB__',
    '_BWWBWWWBWWB_',
    '_BWWWWWWWWWB_',
    '_BWPWWRWWPWB_',
    '__BWWWWWWWB__',
    '___BWWWWWB___',
    'BB_BWWWWWB_BB',
    'BWB_BWWWB_BWB',
    'BWWB_BWB_BWWB',
    '_BWB_BWB_BWB_',
    '__BB_B_B__BB_',
]))

# Cat 3: 比心小猫 14x16
patterns.append(('比心小猫', 14, [
    '_BB________BB_',
    'BWWB______BWWB',
    'BWWWB____BWWWB',
    '_BWWBBBBBBWWB_',
    '_BWWWWWWWWWWB_',
    '_BWWBWWWWBWWB_',
    '_BWWWWWWWWWWB_',
    '_BWWWWWWWWWWB_',
    '_BWWPWWWWPWWB_',
    '__BWWWWWWWWB__',
    '__BWWWWWWWWB__',
    '___BWWWWWWB___',
    '___BWB__BWB___',
    '___BWB__BWB___',
    '___BWB__BWB___',
    '___BB____BB___',
]))

# Cat 4: 害羞兔兔 13x18
patterns.append(('害羞兔兔', 13, [
    '___BB___BB___',
    '__BWWB_BWWB__',
    '__BWPB_BPWB__',
    '__BWWB_BWWB__',
    '__BWWB_BWWB__',
    '__BWWBBBWWB__',
    '_BWWWWWWWWWB_',
    '_BWWBWWWBWWB_',
    '_BWWWWWWWWWB_',
    '_BWPWWWWWPWB_',
    '_BWWWWRWWWWB_',
    '__BWWWWWWWB__',
    '__BWWWWWWWB__',
    '___BWWWWWB___',
    '___BWWWWWB___',
    '___BWB_BWB___',
    '___BWB_BWB___',
    '___BB___BB___',
]))

# Cat 5: 爱心表情 13x13
patterns.append(('爱心表情', 13, [
    '____BBBBB____',
    '__BBWWWWWBB__',
    '_BWWWWWWWWWB_',
    'BWWRRWWWRRWWB',
    'BWRRRWWWRRRWB',
    'BWWRRWWWRRWWB',
    'BWWWWWWWWWWWB',
    'BWWWWWWWWWWWB',
    'BWWPWWRWWPWWB',
    '_BWWWWWWWWWB_',
    '__BWWWWWWWB__',
    '___BBWWWBB___',
    '_____BBB_____',
]))

# Cat 6: 大笑圆脸 13x13
patterns.append(('大笑圆脸', 13, [
    '____BBBBB____',
    '__BBWWWWWBB__',
    '_BWWWWWWWWWB_',
    'BWWWBWWWBWWWB',
    'BWWWBWWWBWWWB',
    'BWWWWWWWWWWWB',
    'BWWWWWWWWWWWB',
    'BWWBWWWWWBWWB',
    'BWWWBBBBBWWWB',
    '_BWWWWWWWWWB_',
    '__BWWWWWWWB__',
    '___BBWWWBB___',
    '_____BBB_____',
]))

# Cat 7: 微笑云朵 15x10
patterns.append(('微笑云朵', 15, [
    '_____BBBBB_____',
    '___BBWWWWWBB___',
    '_BBBWWWWWWWBBB_',
    'BWWWWWWWWWWWWWB',
    'BWWWBWWWWWBWWWB',
    'BWWWWWWWWWWWWWB',
    'BWWWWWWWWWWWWWB',
    'BWWWWBWWWBWWWWB',
    '_BWWWWBBBWWWWB_',
    '__BBBBBBBBBBB__',
]))

OUT = os.path.join(os.path.dirname(__file__), '..', 'js', 'gallery-patterns.js')

with open(OUT, 'w') as f:
    # Write utility functions
    f.write("""function decodePattern(data, palette) {
  const pMap = {};
  palette.forEach(c => {
    const v = parseInt(c.hex.slice(1), 16);
    const rgb = { r: (v >> 16) & 0xFF, g: (v >> 8) & 0xFF, b: v & 0xFF };
    pMap[c.code] = { code: c.code, name: c.name, hex: c.hex, rgb, lab: [0,0,0] };
  });
  const grid = [], counts = {};
  let total = 0;
  data.rows.forEach(rowStr => {
    const row = [];
    rowStr.split(",").forEach(code => {
      const c = code.trim();
      if (c === "." || !c) { row.push(null); return; }
      const bead = pMap[c];
      if (!bead) { row.push(null); return; }
      row.push(bead);
      counts[c] = (counts[c] || 0) + 1;
      total++;
    });
    grid.push(row);
  });
  return { grid, width: data.width, height: data.rows.length,
    colorCounts: counts, totalBeads: total, uniqueColors: Object.keys(counts).length };
}

function renderPatternThumb(data, size) {
  const cvs = document.createElement("canvas");
  const w = data.width, h = data.rows.length;
  const cell = Math.max(1, Math.floor(size / Math.max(w, h)));
  cvs.width = w * cell; cvs.height = h * cell;
  const ctx = cvs.getContext("2d");
  const pMap = {};
  BEAD_PALETTES.mard.colors.forEach(c => pMap[c.code] = c.hex);
  data.rows.forEach((rowStr, y) => {
    rowStr.split(",").forEach((code, x) => {
      const c = code.trim();
      if (c === "." || !c || !pMap[c]) return;
      ctx.fillStyle = pMap[c];
      ctx.fillRect(x * cell, y * cell, cell, cell);
    });
  });
  return cvs.toDataURL("image/png");
}

""")
    f.write('const PATTERN_GALLERY = [\n')
    f.write('  {\n    id: "emoji-cute",\n    name: "🔥 可爱表情包",\n    items: [\n')

    for i, (name, w, rows) in enumerate(patterns):
        expanded = expand(rows, w)
        f.write(f'      {{ name: "{name}", width: {w}, rows: [\n')
        for j, row in enumerate(expanded):
            comma = ',' if j < len(expanded)-1 else ''
            f.write(f'        "{row}"{comma}\n')
        comma = ',' if i < len(patterns)-1 else ''
        f.write(f'      ] }}{comma}\n')

    f.write('    ]\n  },\n')

print(f'Part 1 done: {OUT}')
