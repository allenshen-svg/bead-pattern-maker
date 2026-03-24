#!/usr/bin/env python3
"""Generate gallery-patterns.js Part 2: more categories"""
import os

C = {'B':'H23','W':'H19','P':'F2','R':'F17','K':'F8','Y':'A4','G':'B4','L':'C10','O':'A6','T':'A13','_':'.'}

def expand(rows, w):
    out = []
    for r in rows:
        cells = [C.get(ch, '.') for ch in r]
        while len(cells) < w: cells.append('.')
        out.append(','.join(cells[:w]))
    return out

# ── Category 2: 萌宠动物 ──
animals = []

# 小柴犬 14x14
animals.append(('小柴犬', 14, [
    '____BBBBBB____',
    '__BBOOOOOOBB__',
    '_BBOOOOOOOO_B_',
    '_BOOOOOOOOOOB_',
    'BOOWBOOOOBWOB_',
    'BOOOOOOOOOOOB_',
    'BOOOOOBBOOOOB_',
    '_BOOWWWWWWOOB_',
    '_BOWWWWWWWWOB_',
    '__BWWWWWWWWB__',
    '__BOOOOOOOOB__',
    '___BOOOOOOB___',
    '___BWB__BWB___',
    '___BB____BB___',
]))

# 圆滚熊猫 13x13
animals.append(('圆滚熊猫', 13, [
    '_BB_______BB_',
    'BBBB_____BBBB',
    'BBBBBBBBBBBB_',
    '_BWWWWWWWWWB_',
    'BWWBBWWWBBWWB',
    'BWWBBWWWBBWWB',
    'BWWWWWBWWWWWB',
    'BWWWWWWWWWWWB',
    'BWWWBWWWBWWWB',
    '_BWWWBBBWWWB_',
    '__BWWWWWWWB__',
    '___BWWWWWB___',
    '____BBBBB____',
]))

# 小企鹅 12x14
animals.append(('小企鹅', 12, [
    '____BBBB____',
    '___BBBBBB___',
    '__BBBWWBBB__',
    '_BBWWWWWWBB_',
    'BBBWBWWBWBBB',
    'BWBBWWWWBBWB',
    'BWWBWWWWBWWB',
    'BWWBWWWWBWWB',
    '_BWBWWWWBWB_',
    '_BWBBBBBBWB_',
    '__BWWWWWWB__',
    '__BWWWWWWB__',
    '__BYBB_BBYB_',
    '___BB___BB__',
]))

# 小青蛙 13x12
animals.append(('小青蛙', 13, [
    '_BBB_____BBB_',
    'BGWGB___BGWGB',
    'BGGGB___BGGGB',
    '_BGGGBBBGGGB_',
    '_BGGGGGGGGGB_',
    'BGGGGGGGGGGGB',
    'BGGGGGGGGGGB_',
    'BGBGGGGGGGBGB',
    'BGGBBBBBBBGGB',
    '_BGGGGGGGGGB_',
    '__BGGGGGGGB__',
    '___BBBBBBB___',
]))

# 小鸭子 12x13
animals.append(('小鸭子', 12, [
    '____BBBB____',
    '___BYYYYB___',
    '__BYYYYYYY__',
    '_BYBYWWBYBB_',
    '_BYYYYYYYY__',
    '_BYYYYYYBYB_',
    'BBOOBYYYYY__',
    'BOOOBYYYY___',
    '_BBOBYYYY___',
    '___BYYYYB___',
    '___BYYYYB___',
    '___BOBB_BOB_',
    '___BB____BB_',
]))

# 小兔子 11x16
animals.append(('可爱兔兔', 11, [
    '___BB_BB___',
    '__BWWBPWB__',
    '__BWWBPWB__',
    '__BWWBWWB__',
    '__BWWBWWB__',
    '_BWWWWWWWB_',
    'BWWWWWWWWWB',
    'BWWBWWWBWWB',
    'BWWWWWWWWWB',
    'BWWPWWWPWWB',
    'BWWWWRWWWWB',
    '_BWWWWWWWB_',
    '__BWWWWWB__',
    '__BWB_BWB__',
    '__BWB_BWB__',
    '__BB___BB__',
]))

OUT = os.path.join(os.path.dirname(__file__), '..', 'js', 'gallery-patterns.js')

with open(OUT, 'a') as f:
    f.write('  {\n    id: "cute-animals",\n    name: "🐾 萌宠动物",\n    items: [\n')
    for i, (name, w, rows) in enumerate(animals):
        expanded = expand(rows, w)
        f.write(f'      {{ name: "{name}", width: {w}, rows: [\n')
        for j, row in enumerate(expanded):
            comma = ',' if j < len(expanded)-1 else ''
            f.write(f'        "{row}"{comma}\n')
        comma = ',' if i < len(animals)-1 else ''
        f.write(f'      ] }}{comma}\n')
    f.write('    ]\n  },\n')

print('Part 2 done: cute animals')
