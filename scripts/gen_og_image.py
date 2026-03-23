"""Generate OG image for pindou.top (1200x630 social sharing image)"""
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1200, 630
img = Image.new('RGB', (W, H), '#6366f1')
draw = ImageDraw.Draw(img)

# gradient-like bottom bar
draw.rectangle([0, H-80, W, H], fill='#1e293b')

# grid pattern hint
for x in range(0, W, 30):
    draw.line([(x, 100), (x, H-120)], fill='#7c7ff2', width=1)
for y in range(100, H-120, 30):
    draw.line([(0, y), (W, y)], fill='#7c7ff2', width=1)

# small colored bead dots
import random
random.seed(42)
colors = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#a855f7','#ec4899','#ffffff']
for x in range(15, W, 30):
    for y in range(115, H-120, 30):
        if random.random() < 0.35:
            c = random.choice(colors)
            draw.ellipse([x-8, y-8, x+8, y+8], fill=c)

# title text
try:
    font_big = ImageFont.truetype("/System/Library/Fonts/PingFang.ttc", 64)
    font_sm  = ImageFont.truetype("/System/Library/Fonts/PingFang.ttc", 28)
except:
    font_big = ImageFont.load_default()
    font_sm  = ImageFont.load_default()

# dark overlay for text readability
draw.rectangle([0, 0, W, 95], fill='#1e293b')
draw.text((W//2, 48), '🎨 拼豆图案生成器', fill='#ffffff', font=font_big, anchor='mm')
draw.text((W//2, H-40), 'pindou.top · 免费在线拼豆图纸制作工具', fill='#94a3b8', font=font_sm, anchor='mm')

out = os.path.join(os.path.dirname(__file__), '..', 'og-image.png')
img.save(out, 'PNG')
print(f'Saved {out}')
