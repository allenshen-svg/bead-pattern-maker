#!/usr/bin/env python3
"""
Convert painting images to MARD bead patterns (PATTERN_GALLERY format).
Outputs JS code that can be appended to gallery-patterns.js.
"""
import re, json, math
from pathlib import Path
from PIL import Image

# ── Paths ──
BASE = Path(__file__).parent.parent
PAINTINGS_DIR = BASE / "paintings"
COLORS_JS = BASE / "js" / "colors.js"
OUTPUT_JS = PAINTINGS_DIR / "painting_patterns.js"

# ── Target bead grid size ──
TARGET_WIDTH = 40  # beads wide — good balance of detail vs difficulty

# ── Extract MARD palette from colors.js ──
def load_mard_palette():
    content = COLORS_JS.read_text()
    mard_start = content.find("mard:")
    mard_end = content.find("perler:")
    mard_block = content[mard_start:mard_end]
    codes = re.findall(r"code:\s*'([^']+)'.*?hex:\s*'([^']+)'", mard_block)
    palette = []
    for code, hexc in codes:
        r = int(hexc[1:3], 16)
        g = int(hexc[3:5], 16)
        b = int(hexc[5:7], 16)
        palette.append((code, r, g, b))
    return palette

# ── Color distance (weighted Euclidean in sRGB — simple but good enough) ──
def color_dist(r1, g1, b1, r2, g2, b2):
    # Weighted by human perception
    rmean = (r1 + r2) / 2
    dr = r1 - r2
    dg = g1 - g2
    db = b1 - b2
    return math.sqrt((2 + rmean/256) * dr*dr + 4 * dg*dg + (2 + (255-rmean)/256) * db*db)

def find_nearest_bead(r, g, b, palette, cache={}):
    key = (r, g, b)
    if key in cache:
        return cache[key]
    best_code = palette[0][0]
    best_dist = float('inf')
    for code, pr, pg, pb in palette:
        d = color_dist(r, g, b, pr, pg, pb)
        if d < best_dist:
            best_dist = d
            best_code = code
    cache[key] = best_code
    return best_code

# ── Convert image to bead pattern ──
def image_to_pattern(img_path, palette, target_w=TARGET_WIDTH):
    img = Image.open(img_path).convert('RGB')
    w, h = img.size
    target_h = int(target_w * h / w)
    
    # Resize with high-quality downsampling
    img = img.resize((target_w, target_h), Image.LANCZOS)
    
    rows = []
    for y in range(target_h):
        row = []
        for x in range(target_w):
            r, g, b = img.getpixel((x, y))
            code = find_nearest_bead(r, g, b, palette)
            row.append(code)
        rows.append(",".join(row))
    
    return target_w, rows

# ── Painting metadata ──
PAINTINGS = {
    "starry_night": {"name": "🌌 星空 Starry Night", "artist": "梵高", "year": "1889"},
    "great_wave": {"name": "🌊 神奈川冲浪里", "artist": "葛饰北斋", "year": "1831"},
    "water_lilies": {"name": "🪷 睡莲 Water Lilies", "artist": "莫奈", "year": "1906"},
    "impression_sunrise": {"name": "🌅 日出·印象", "artist": "莫奈", "year": "1872"},
    "almond_blossoms": {"name": "🌸 杏花 Almond Blossoms", "artist": "梵高", "year": "1890"},
    "persistence_memory": {"name": "⏰ 记忆的永恒", "artist": "达利", "year": "1931"},
}

def main():
    palette = load_mard_palette()
    print(f"Loaded {len(palette)} MARD colors")
    
    items = []
    for img_file in sorted(PAINTINGS_DIR.glob("*.jpg")):
        stem = img_file.stem
        if stem not in PAINTINGS:
            print(f"Skipping unknown: {img_file.name}")
            continue
        
        meta = PAINTINGS[stem]
        print(f"Converting: {meta['name']} ...", end=" ", flush=True)
        
        width, rows = image_to_pattern(img_file, palette)
        print(f"{width}×{len(rows)} beads")
        
        items.append({
            "name": meta["name"],
            "width": width,
            "rows": rows,
        })
    
    # Generate JS
    js_items = []
    for item in items:
        rows_str = ",\n          ".join(f'"{r}"' for r in item["rows"])
        js_items.append(f"""      {{
        name: "{item['name']}",
        width: {item['width']},
        rows: [
          {rows_str}
        ]
      }}""")
    
    gallery_entry = f"""  {{
    id: "world-paintings",
    name: "🎨 世界名画",
    items: [
{(","+chr(10)).join(js_items)}
    ]
  }}"""
    
    OUTPUT_JS.write_text(gallery_entry)
    print(f"\nGenerated: {OUTPUT_JS}")
    print(f"Total: {len(items)} paintings converted")
    print(f"\nPaste this into PATTERN_GALLERY array in js/gallery-patterns.js")

if __name__ == '__main__':
    main()
