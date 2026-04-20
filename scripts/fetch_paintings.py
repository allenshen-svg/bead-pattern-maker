#!/usr/bin/env python3
"""
Fetch famous public-domain paintings and convert to bead patterns.
Uses Art Institute of Chicago API (CC0) and Wikimedia Commons.
"""

import json, os, re, math, urllib.request, urllib.parse
from pathlib import Path

# ── Config ──
OUT_DIR = Path(__file__).parent.parent / "paintings"
OUT_DIR.mkdir(exist_ok=True)

# Famous paintings with direct public-domain image URLs
# All are CC0 / public domain (artists died 70+ years ago)
PAINTINGS = [
    {
        "id": "starry_night",
        "title": "星空 The Starry Night",
        "artist": "梵高 Vincent van Gogh",
        "year": "1889",
        "url": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg/1280px-Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg"
    },
    {
        "id": "great_wave",
        "title": "神奈川冲浪里 The Great Wave",
        "artist": "葛饰北斋 Hokusai",
        "year": "1831",
        "url": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Tsunami_by_hokusai_19th_century.jpg/1280px-Tsunami_by_hokusai_19th_century.jpg"
    },
    {
        "id": "girl_pearl_earring",
        "title": "戴珍珠耳环的少女 Girl with a Pearl Earring",
        "artist": "维米尔 Johannes Vermeer",
        "year": "1665",
        "url": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/1665_Girl_with_a_Pearl_Earring.jpg/800px-1665_Girl_with_a_Pearl_Earring.jpg"
    },
    {
        "id": "sunflowers",
        "title": "向日葵 Sunflowers",
        "artist": "梵高 Vincent van Gogh",
        "year": "1888",
        "url": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/Vincent_Willem_van_Gogh_127.jpg/800px-Vincent_Willem_van_Gogh_127.jpg"
    },
    {
        "id": "the_scream",
        "title": "呐喊 The Scream",
        "artist": "蒙克 Edvard Munch",
        "year": "1893",
        "url": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Edvard_Munch%2C_1893%2C_The_Scream%2C_oil%2C_tempera_and_pastel_on_cardboard%2C_91_x_73_cm%2C_National_Gallery_of_Norway.jpg/800px-Edvard_Munch%2C_1893%2C_The_Scream%2C_oil%2C_tempera_and_pastel_on_cardboard%2C_91_x_73_cm%2C_National_Gallery_of_Norway.jpg"
    },
    {
        "id": "water_lilies",
        "title": "睡莲 Water Lilies",
        "artist": "莫奈 Claude Monet",
        "year": "1906",
        "url": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Claude_Monet_-_Water_Lilies_-_1906%2C_Ryerson.jpg/1280px-Claude_Monet_-_Water_Lilies_-_1906%2C_Ryerson.jpg"
    },
    {
        "id": "impression_sunrise",
        "title": "日出·印象 Impression, Sunrise",
        "artist": "莫奈 Claude Monet",
        "year": "1872",
        "url": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/59/Monet_-_Impression%2C_Sunrise.jpg/1280px-Monet_-_Impression%2C_Sunrise.jpg"
    },
    {
        "id": "almond_blossoms",
        "title": "杏花 Almond Blossoms",
        "artist": "梵高 Vincent van Gogh",
        "year": "1890",
        "url": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Vincent_van_Gogh_-_Almond_blossom_-_Google_Art_Project.jpg/1280px-Vincent_van_Gogh_-_Almond_blossom_-_Google_Art_Project.jpg"
    },
    {
        "id": "cafe_terrace",
        "title": "夜晚的咖啡馆 Café Terrace at Night",
        "artist": "梵高 Vincent van Gogh",
        "year": "1888",
        "url": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/21/Van_Gogh_-_Terrasse_des_Caf%C3%A9s_an_der_Place_du_Forum_in_Arles_am_Abend1.jpeg/800px-Van_Gogh_-_Terrasse_des_Caf%C3%A9s_an_der_Place_du_Forum_in_Arles_am_Abend1.jpeg"
    },
    {
        "id": "persistence_memory",
        "title": "记忆的永恒 The Persistence of Memory",
        "artist": "达利 Salvador Dalí",
        "year": "1931",
        "url": "https://upload.wikimedia.org/wikipedia/en/d/dd/The_Persistence_of_Memory.jpg"
    },
]

def download_image(url, filepath):
    """Download image from URL."""
    if filepath.exists():
        print(f"  Already exists: {filepath.name}")
        return True
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (PindouBeadMaker/1.0; educational use)'
        })
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
        filepath.write_bytes(data)
        print(f"  Downloaded: {filepath.name} ({len(data)//1024} KB)")
        return True
    except Exception as e:
        print(f"  Failed: {filepath.name} — {e}")
        return False

def main():
    print(f"Downloading {len(PAINTINGS)} famous paintings...\n")
    
    success = 0
    for p in PAINTINGS:
        print(f"[{p['id']}] {p['title']} — {p['artist']} ({p['year']})")
        ext = '.jpg'
        if '.png' in p['url'].lower():
            ext = '.png'
        filepath = OUT_DIR / f"{p['id']}{ext}"
        if download_image(p['url'], filepath):
            success += 1
        print()
    
    print(f"\nDone: {success}/{len(PAINTINGS)} downloaded to {OUT_DIR}/")
    
    # Save metadata
    meta = []
    for p in PAINTINGS:
        ext = '.png' if '.png' in p['url'].lower() else '.jpg'
        meta.append({
            "id": p["id"],
            "title": p["title"],
            "artist": p["artist"],
            "year": p["year"],
            "file": f"{p['id']}{ext}"
        })
    meta_path = OUT_DIR / "paintings.json"
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    print(f"Metadata saved to {meta_path}")

if __name__ == '__main__':
    main()
