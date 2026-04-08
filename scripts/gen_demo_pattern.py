"""Generate demo-pattern.png with transparent background from demo-original.png"""
import math
from PIL import Image, ImageDraw, ImageFont

# MARD palette (subset of most common colors)
MARD_COLORS = [
    ('A1','#FFF8E1'),('A2','#FFF9C4'),('A3','#FFEE58'),('A4','#FFD600'),
    ('A5','#FFAB00'),('A6','#FF8F00'),('A7','#EF6C00'),('A8','#FFAD42'),
    ('A9','#E88A30'),('A10','#D06020'),('A11','#FF7F00'),('A12','#CC4125'),
    ('A13','#8D6E63'),('A14','#FFECB3'),('A15','#FFE4B5'),('A16','#FFFDE7'),
    ('A17','#FFD54F'),('A18','#B57030'),('A19','#9E6228'),('A20','#FFCA28'),
    ('A21','#6D4830'),('A22','#5C3D28'),('A23','#503520'),('A24','#442D1A'),
    ('A25','#382515'),('A26','#2E1E10'),
    ('B1','#C6FF00'),('B2','#AEEA00'),('B3','#64DD17'),('B4','#4CAF50'),
    ('B5','#43A047'),('B6','#388E3C'),('B7','#2E7D32'),('B8','#1B5E20'),
    ('B9','#33691E'),('B10','#194D19'),('B11','#558B2F'),('B12','#689F38'),
    ('B13','#8BC34A'),('B14','#66BB6A'),('B15','#81C784'),('B16','#A5D6A7'),
    ('B17','#C8E6C9'),('B18','#009688'),('B19','#4DB6AC'),('B20','#80CBC4'),
    ('B21','#B2DFDB'),('B22','#00897B'),('B23','#00695C'),('B24','#004D40'),
    ('B25','#26A69A'),('B26','#7CB342'),('B27','#827717'),('B28','#5D6B1A'),
    ('B29','#4B5320'),('B30','#6B8E5A'),('B31','#94B576'),('B32','#AED581'),
    ('C1','#E3F2FD'),('C2','#BBDEFB'),('C3','#90CAF9'),('C4','#64B5F6'),
    ('C5','#42A5F5'),('C6','#2196F3'),('C7','#1E88E5'),('C8','#1565C0'),
    ('C9','#0D47A1'),('C10','#1A237E'),('C11','#283593'),('C12','#3949AB'),
    ('C13','#3F51B5'),('C14','#5C6BC0'),('C15','#7986CB'),('C16','#9FA8DA'),
    ('C17','#0D47A1'),('C18','#1A1A6B'),('C19','#0288D1'),('C20','#03A9F4'),
    ('C21','#4FC3F7'),('C22','#81D4FA'),('C23','#B3E5FC'),('C24','#29B6F6'),
    ('C25','#0277BD'),('C26','#01579B'),('C27','#546E7A'),('C28','#37474F'),
    ('C29','#263238'),
    ('D1','#E1BEE7'),('D2','#CE93D8'),('D3','#BA68C8'),('D4','#AB47BC'),
    ('D5','#9C27B0'),('D6','#8E24AA'),('D7','#7B1FA2'),('D8','#6A1B9A'),
    ('D9','#4A148C'),('D10','#5E35B1'),('D11','#4527A0'),('D12','#311B92'),
    ('D13','#512DA8'),('D14','#7E57C2'),('D15','#9575CD'),('D16','#B39DDB'),
    ('D17','#D1C4E9'),('D18','#E040FB'),('D19','#D500F9'),('D20','#AA00FF'),
    ('D21','#C51162'),('D22','#880E4F'),('D23','#6A0040'),('D24','#4A0033'),
    ('D25','#7C1A8E'),('D26','#5A0068'),
    ('E1','#FFF5EE'),('E2','#FFE8D6'),('E3','#FFDAB9'),('E4','#FFD0A8'),
    ('E5','#FFC096'),('E6','#F5B07A'),('E7','#E8A465'),('E8','#D4944A'),
    ('E9','#C68642'),('E10','#B07030'),('E11','#9A5E28'),('E12','#8D5524'),
    ('E13','#7A4820'),('E14','#6B3A18'),('E15','#5C3010'),('E16','#FFB5A0'),
    ('E17','#FFCCBC'),('E18','#FFD8C0'),('E19','#D2B48C'),('E20','#C4A87A'),
    ('E21','#A68B5C'),('E22','#E8D4B8'),('E23','#F0E0CC'),('E24','#F5E6D0'),
    ('F1','#FCE4EC'),('F2','#F8BBD0'),('F3','#F48FB1'),('F4','#EC407A'),
    ('F5','#E91E63'),('F6','#C2185B'),('F7','#AD1457'),('F8','#FF4081'),
    ('F9','#FF1744'),('F10','#D32F2F'),('F11','#C62828'),('F12','#B71C1C'),
    ('F13','#8B1A1A'),('F14','#7B0D0D'),('F15','#FF6F61'),('F16','#FA8072'),
    ('F17','#FF8A80'),('F18','#EF5350'),('F19','#E53935'),('F20','#C0392B'),
    ('F21','#A02B1F'),('F22','#7F1D1D'),('F23','#5C1510'),('F24','#880E4F'),
    ('F25','#6A1039'),
    ('G1','#D8C8A8'),('G2','#D0BF98'),('G3','#C0AE88'),('G4','#B0A078'),
    ('G5','#A49468'),('G6','#988860'),('G7','#887050'),('G8','#7A6040'),
    ('G9','#6C5438'),('G10','#604A30'),('G11','#544028'),('G12','#483820'),
    ('G13','#3A2E1E'),('G14','#E0D0B4'),('G15','#D5C6A4'),('G16','#C4B494'),
    ('G17','#B4A282'),('G18','#9A8A6E'),('G19','#7E7058'),('G20','#605040'),
    ('G21','#484038'),
    ('H1','#333333'),('H2','#B0B0B0'),('H3','#D0D0D0'),('H4','#C0C0C0'),
    ('H5','#9E9E9E'),('H6','#707070'),('H7','#606060'),('H8','#F5F5F5'),
    ('H9','#EEEEEE'),('H10','#A0A0A0'),('H11','#888888'),('H12','#78909C'),
    ('H13','#90A4AE'),('H14','#A89890'),('H15','#C0B4A8'),('H16','#6B6B6B'),
    ('H17','#505050'),('H18','#2A2A2A'),('H19','#FFFFFF'),('H20','#E8E0D8'),
    ('H21','#404040'),('H22','#383838'),('H23','#1A1A1A'),
    ('M1','#0A2540'),('M2','#2D1B4E'),('M3','#004040'),('M4','#2B3A1A'),
    ('M5','#3E2215'),('M6','#421515'),('M7','#1A3018'),('M8','#1A1A40'),
    ('M9','#400D14'),('M10','#5A1818'),('M11','#1A3A20'),('M12','#102040'),
    ('M13','#302018'),('M14','#382838'),('M15','#1A2020'),
    ('P1','#F8F8FF'),('P2','#FFE4E1'),('P3','#B0C4DE'),('P4','#B0E0C8'),
    ('P5','#D8BFD8'),('P6','#FFE4B5'),('P7','#D8D8D8'),('P8','#FFB4B4'),
    ('P9','#FFDAB0'),('P10','#FAFAD2'),('P11','#AFEEEE'),('P12','#CDAA7D'),
    ('P13','#C0C0C0'),('P14','#3A3A3A'),('P15','#FFB0C0'),('P16','#E0B0FF'),
    ('P17','#A6CAF0'),('P18','#A0E8C0'),('P19','#87CEEB'),('P20','#FFF8EA'),
    ('P21','#F5E8D0'),('P22','#CD9B9B'),('P23','#7AB888'),
]

def hex_to_rgb(h):
    v = int(h[1:], 16)
    return ((v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF)

def rgb_to_lab(r, g, b):
    # sRGB -> linear
    rr, gg, bb = r/255, g/255, b/255
    for c in [rr, gg, bb]:
        pass
    rr = ((rr+0.055)/1.055)**2.4 if rr > 0.04045 else rr/12.92
    gg = ((gg+0.055)/1.055)**2.4 if gg > 0.04045 else gg/12.92
    bb = ((bb+0.055)/1.055)**2.4 if bb > 0.04045 else bb/12.92
    x = (rr*0.4124564 + gg*0.3575761 + bb*0.1804375) / 0.95047
    y = (rr*0.2126729 + gg*0.7151522 + bb*0.0721750)
    z = (rr*0.0193339 + gg*0.1191920 + bb*0.9503041) / 1.08883
    def f(t): return t**(1/3) if t > 0.008856 else 7.787*t + 16/116
    x, y, z = f(x), f(y), f(z)
    return (116*y - 16, 500*(x - y), 200*(y - z))

def delta_e(a, b):
    return math.sqrt(sum((x-y)**2 for x, y in zip(a, b)))

# Prepare palette
palette = []
for code, hexc in MARD_COLORS:
    rgb = hex_to_rgb(hexc)
    lab = rgb_to_lab(*rgb)
    palette.append((code, hexc, rgb, lab))

def find_nearest(r, g, b):
    # Force very dark pixels to pure black (H23) to unify outlines
    brightness = (r * 299 + g * 587 + b * 114) / 1000
    if brightness < 60:
        return ('H23', '#1A1A1A', (26, 26, 26), rgb_to_lab(26, 26, 26))
    lab = rgb_to_lab(r, g, b)
    best = min(palette, key=lambda c: delta_e(lab, c[3]))
    return best  # (code, hex, rgb, lab)

# Load image
img = Image.open('img/demo-original.png').convert('RGB')
GRID_W = 50
aspect = img.height / img.width
GRID_H = round(GRID_W * aspect)

# Downsample with NEAREST to preserve sharp black outlines
small = img.resize((GRID_W, GRID_H), Image.NEAREST)

# Convert to bead grid
grid = []
for y in range(GRID_H):
    row = []
    for x in range(GRID_W):
        r, g, b = small.getpixel((x, y))
        row.append(find_nearest(r, g, b))
    grid.append(row)

# Find background color (most frequent)
from collections import Counter
counts = Counter()
for row in grid:
    for cell in row:
        counts[cell[0]] += 1
bg_code = counts.most_common(1)[0][0]
print(f"Background color: {bg_code} ({counts[bg_code]} cells)")

# Render pattern image (transparent bg, with grid lines and color codes)
CELL = 13
AXIS_M = 20  # margin for axis labels
canvas_w = AXIS_M + GRID_W * CELL + AXIS_M
canvas_h = AXIS_M + GRID_H * CELL + AXIS_M

out = Image.new('RGBA', (canvas_w, canvas_h), (0, 0, 0, 0))
draw = ImageDraw.Draw(out)

# Draw cells (skip background)
for y in range(GRID_H):
    for x in range(GRID_W):
        code, hexc, rgb, lab = grid[y][x]
        if code == bg_code:
            continue
        px = AXIS_M + x * CELL
        py = AXIS_M + y * CELL
        draw.rectangle([px, py, px + CELL - 1, py + CELL - 1], fill=rgb + (255,))

# Draw grid lines (light)
for x in range(GRID_W + 1):
    px = AXIS_M + x * CELL
    draw.line([(px, AXIS_M), (px, AXIS_M + GRID_H * CELL)], fill=(0, 0, 0, 30), width=1)
for y in range(GRID_H + 1):
    py = AXIS_M + y * CELL
    draw.line([(AXIS_M, py), (AXIS_M + GRID_W * CELL, py)], fill=(0, 0, 0, 30), width=1)

# Major grid lines every 5
for x in range(5, GRID_W + 1, 5):
    px = AXIS_M + x * CELL
    draw.line([(px, AXIS_M), (px, AXIS_M + GRID_H * CELL)], fill=(0, 0, 0, 80), width=1)
for y in range(5, GRID_H + 1, 5):
    py = AXIS_M + y * CELL
    draw.line([(AXIS_M, py), (AXIS_M + GRID_W * CELL, py)], fill=(0, 0, 0, 80), width=1)

# Draw color codes
try:
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 7)
except:
    font = ImageFont.load_default()

for y in range(GRID_H):
    for x in range(GRID_W):
        code, hexc, rgb, lab = grid[y][x]
        if code == bg_code:
            continue
        brightness = (rgb[0]*299 + rgb[1]*587 + rgb[2]*114) / 1000
        color = (0, 0, 0, 200) if brightness > 140 else (255, 255, 255, 200)
        tx = AXIS_M + x * CELL + 1
        ty = AXIS_M + y * CELL + 1
        draw.text((tx, ty), code, fill=color, font=font)

# Axis numbers
for x in range(GRID_W):
    draw.text((AXIS_M + x * CELL + 1, 2), str(x+1),
              fill=(100, 100, 100, 180), font=font)
for y in range(GRID_H):
    draw.text((1, AXIS_M + y * CELL + 1), str(y+1),
              fill=(100, 100, 100, 180), font=font)

# Save
out.save('img/demo-pattern.png')
print(f"Saved img/demo-pattern.png ({canvas_w}x{canvas_h})")
