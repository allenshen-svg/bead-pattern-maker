#!/usr/bin/env python3
"""Generate gallery-patterns.js Part 3: food + gestures + closing"""
import os

C = {'B':'H23','W':'H19','P':'F2','R':'F17','K':'F8','Y':'A4','G':'B4','L':'C10','O':'A6','T':'A13','N':'E6','_':'.'}

def expand(rows, w):
    out = []
    for r in rows:
        cells = [C.get(ch, '.') for ch in r]
        while len(cells) < w: cells.append('.')
        out.append(','.join(cells[:w]))
    return out

# ── Category 3: 美食甜品 ──
food = []

# 奶茶杯 10x16
food.append(('奶茶杯', 10, [
    '____BB____',
    '___BWWB___',
    '__BWWWWB__',
    'BBBBBBBBBB',
    'BWWWWWWWWB',
    'BWWWWWWWWB',
    'BTTTTTTTB_',
    '_BTTTTTB__',
    '_BTTTTTTB_',
    '_BTWWWWTB_',
    '_BTWWWWTB_',
    '__BTTTTTB_',
    '__BTTTTB__',
    '__BTTTTB__',
    '___BTTTB__',
    '___BBBB___',
]))

# 小蛋糕 12x12
food.append(('小蛋糕', 12, [
    '_____RR_____',
    '____RRRR____',
    '_____BB_____',
    '____BPPB____',
    '__BBPPPPBB__',
    '_BPPPPPPPPB_',
    '_BKPKPKPKPB_',
    'BWWWWWWWWWWWB',
    'BYYYYYYYYYYY',
    'BYYYYYYYYYYY',
    'BYYYYYYYYYYY',
    '_BBBBBBBBBBB',
]))

# 冰淇淋 9x15
food.append(('冰淇淋', 9, [
    '___BBB___',
    '__BPPPB__',
    '_BPPPPPB_',
    'BPPPPPPPB',
    'BPPPPPPPB',
    'BPPPPPPPB',
    'BWWWWWWWB',
    '_BYYYYB__',
    '__BYYYB__',
    '__BYYYB__',
    '___BYYB__',
    '___BYYB__',
    '___BYYB__',
    '____BYB__',
    '____BBB__',
]))

# 小西瓜 13x10
food.append(('小西瓜', 13, [
    '____BBBBB____',
    '__BBGGGGGBB__',
    '_BGGGGGGGGGB_',
    'BGGGRGRGRGGB_',
    'BGGRGRGRGRGGB',
    'BGGGRGRGRGGGB',
    'BGGGRGRGRGGB_',
    '_BGGGGGGGGGB_',
    '__BBBBBBBBB__',
    '____BBBBB____',
]))

# 甜甜圈 11x11
food.append(('甜甜圈', 11, [
    '___BBBBB___',
    '__BPPPPPB__',
    '_BPPKPKPPB_',
    'BPPPPPPPPPB',
    'BPPP___PPPB',
    'BPP_____PPB',
    'BPPP___PPPB',
    'BPPPPPPPPPB',
    '_BPPPPPPPB_',
    '__BPPPPPB__',
    '___BBBBB___',
]))

# 小寿司 12x10
food.append(('小寿司', 12, [
    '__BBBBBBBB__',
    '_BRRRRRRRRB_',
    'BRRRRRRRRRRB',
    'BRRRRRRRRRRB',
    'BBBBBBBBBBBB',
    'BWWWWWWWWWWB',
    'BWWWWWWWWWWB',
    'BWWWWWWWWWWB',
    'BWWWWWWWWWWB',
    '_BBBBBBBBBB_',
]))

# ── Category 4: 手势表情 ──
gestures = []

# 比心手势 13x14
gestures.append(('比心手势', 13, [
    '________BB___',
    '_______BNNB__',
    '______BNNB___',
    '_BB__BNNB____',
    'BNNBBNNB_____',
    'BNNNNNNB_____',
    '_BNNNNNNB____',
    '__BRRNNNB____',
    '__BRRRNNNB___',
    '__BRRRNNNB___',
    '___BRRNNB____',
    '___BRRNB_____',
    '____BBB______',
    '_____________',
]))

# 竖大拇指 9x14
gestures.append(('竖大拇指', 9, [
    '___BB____',
    '__BNNB___',
    '__BNNB___',
    '__BNNB___',
    '__BNNB___',
    '_BNNNNB__',
    'BNNNNNNB_',
    'BNNNNNNB_',
    'BNNNNNB__',
    'BNNNNNNB_',
    'BNNNNNB__',
    'BNNNNNNB_',
    '_BNNNNB__',
    '__BBBB___',
]))

# OK手势 12x13
gestures.append(('OK手势', 12, [
    '___BBB______',
    '__BNNBB_____',
    '_BNNNBNNB___',
    '_BNNBNNNNB__',
    '_BNNBNNNNNB_',
    '__BNNNNNNNNB',
    '__BNNNNNNNNB',
    '___BNNNNNNB_',
    '____BNNNNNB_',
    '____BNNNNNB_',
    '____BNNNNB__',
    '_____BNNB___',
    '______BB____',
]))

# 剪刀手 10x15
gestures.append(('剪刀手', 10, [
    '__BB__BB__',
    '_BNNBBNNB_',
    '_BNNBBNNB_',
    '_BNNBBNNB_',
    '_BNNBBNNB_',
    '_BNNNNNNB_',
    '_BNNNNNNB_',
    'BNNNNNNNNB',
    'BNNNNNNNNB',
    'BNNNNNNNNB',
    'BNNNNNNNB_',
    'BNNNNNNNNB',
    '_BNNNNNNB_',
    '__BNNNB___',
    '___BBB____',
]))

# 爱心手 12x14
gestures.append(('爱心手势', 12, [
    '_B_______B__',
    'BNB_____BNB_',
    'BNNB___BNNB_',
    'BNNBB_BBNNB_',
    'BNNNNBNNNNB_',
    '_BNNNNNNNNB_',
    '__BNNNNNNB__',
    '__BRRRRRRB__',
    '___BRRRRB___',
    '___BRRRRB___',
    '____BRRB____',
    '____BRRB____',
    '_____BB_____',
    '____________',
]))

OUT = os.path.join(os.path.dirname(__file__), '..', 'js', 'gallery-patterns.js')

with open(OUT, 'a') as f:
    # Food category
    f.write('  {\n    id: "cute-food",\n    name: "🍰 美食甜品",\n    items: [\n')
    for i, (name, w, rows) in enumerate(food):
        expanded = expand(rows, w)
        f.write(f'      {{ name: "{name}", width: {w}, rows: [\n')
        for j, row in enumerate(expanded):
            comma = ',' if j < len(expanded)-1 else ''
            f.write(f'        "{row}"{comma}\n')
        comma = ',' if i < len(food)-1 else ''
        f.write(f'      ] }}{comma}\n')
    f.write('    ]\n  },\n')

    # Gesture category
    f.write('  {\n    id: "gestures",\n    name: "🤟 手势表情",\n    items: [\n')
    for i, (name, w, rows) in enumerate(gestures):
        expanded = expand(rows, w)
        f.write(f'      {{ name: "{name}", width: {w}, rows: [\n')
        for j, row in enumerate(expanded):
            comma = ',' if j < len(expanded)-1 else ''
            f.write(f'        "{row}"{comma}\n')
        comma = ',' if i < len(gestures)-1 else ''
        f.write(f'      ] }}{comma}\n')
    f.write('    ]\n  }\n')

    # Close array
    f.write('];\n')

print('Part 3 done: food + gestures + closing bracket')
