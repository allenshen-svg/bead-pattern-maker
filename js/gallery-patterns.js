function decodePattern(data, palette) {
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

const PATTERN_GALLERY = [
  {
    id: "xhs-cute",
    name: "\ud83d\udd25 \u5c0f\u7ea2\u4e66\u7206\u6b3e",
    items: [
      {
        name: "\u2764\ufe0f \u7231\u5fc3",
        width: 11,
        rows: [
          ".,.,F10,F10,.,.,.,F10,F10,.,.",
          ".,F10,F8,F8,F10,.,F10,F8,F8,F10,.",
          "F10,F8,F8,F8,F8,F10,F8,F8,F8,F8,F10",
          "F10,F8,F8,F8,F8,F8,F8,F8,F8,F8,F10",
          "F10,F8,F8,F8,F8,F8,F8,F8,F8,F8,F10",
          ".,F10,F8,F8,F8,F8,F8,F8,F8,F10,.",
          ".,.,F10,F8,F8,F8,F8,F8,F10,.,.",
          ".,.,.,F10,F8,F8,F8,F10,.,.,.",
          ".,.,.,.,F10,F8,F10,.,.,.,.",
          ".,.,.,.,.,F10,.,.,.,.,."
        ]
      },
      {
        name: "\u2b50 \u661f\u661f",
        width: 11,
        rows: [
          ".,.,.,.,.,A4,.,.,.,.,.",
          ".,.,.,.,A4,A4,A4,.,.,.,.",
          ".,.,.,.,A4,A4,A4,.,.,.,.",
          "A4,A4,A4,A4,A4,A4,A4,A4,A4,A4,A4",
          ".,A4,A4,A4,A4,A4,A4,A4,A4,A4,.",
          ".,.,A4,A4,A4,A4,A4,A4,A4,.,.",
          ".,.,A4,A4,A4,A4,A4,A4,A4,.,.",
          ".,A4,A4,A4,.,.,.,A4,A4,A4,.",
          ".,A4,A4,.,.,.,.,.,A4,A4,.",
          "A4,A4,.,.,.,.,.,.,.,A4,A4",
          "A4,.,.,.,.,.,.,.,.,.,A4"
        ]
      },
      {
        name: "\ud83d\ude0a \u7b11\u8138",
        width: 10,
        rows: [
          ".,.,A4,A4,A4,A4,A4,A4,.,.",
          ".,A4,A4,A4,A4,A4,A4,A4,A4,.",
          "A4,A4,A4,A4,A4,A4,A4,A4,A4,A4",
          "A4,A4,H23,H23,A4,A4,H23,H23,A4,A4",
          "A4,A4,H23,H23,A4,A4,H23,H23,A4,A4",
          "A4,A4,A4,A4,A4,A4,A4,A4,A4,A4",
          "A4,A4,H23,A4,A4,A4,A4,H23,A4,A4",
          "A4,A4,A4,H23,H23,H23,H23,A4,A4,A4",
          ".,A4,A4,A4,A4,A4,A4,A4,A4,.",
          ".,.,A4,A4,A4,A4,A4,A4,.,."
        ]
      },
      {
        name: "\ud83c\udf08 \u5f69\u8679",
        width: 12,
        rows: [
          ".,.,.,F10,F10,F10,F10,F10,F10,.,.,.",
          ".,.,F10,A11,A11,A11,A11,A11,A11,F10,.,.",
          ".,F10,A11,A4,A4,A4,A4,A4,A4,A11,F10,.",
          "F10,A11,A4,B4,B4,B4,B4,B4,B4,A4,A11,F10",
          "F10,A11,A4,B4,C6,C6,C6,C6,B4,A4,A11,F10",
          ".,F10,A4,B4,C6,D5,D5,C6,B4,A4,F10,.",
          ".,.,.,B4,C6,D5,D5,C6,B4,.,.,.",
          ".,.,.,.,C6,D5,D5,C6,.,.,.,."
        ]
      },
      {
        name: "\ud83c\udf80 \u8774\u8776\u7ed3",
        width: 12,
        rows: [
          ".,F3,F3,F3,.,.,.,.,F3,F3,F3,.",
          "F3,F3,F3,F3,F3,.,.,F3,F3,F3,F3,F3",
          "F3,F3,F3,F3,F3,F5,F5,F3,F3,F3,F3,F3",
          ".,F3,F3,F3,F5,F5,F5,F5,F3,F3,F3,.",
          ".,.,F3,F5,F5,F5,F5,F5,F5,F3,.,.",
          ".,F3,F3,F3,F5,F5,F5,F5,F3,F3,F3,.",
          "F3,F3,F3,F3,F3,F5,F5,F3,F3,F3,F3,F3",
          ".,F3,F3,F3,.,.,.,.,F3,F3,F3,."
        ]
      }
    ]
  },
  {
    id: "pixel-animal",
    name: "\ud83d\udc31 \u840c\u5ba0\u50cf\u7d20",
    items: [
      {
        name: "\ud83d\udc31 \u732b\u54aa",
        width: 11,
        rows: [
          ".,H23,.,.,.,.,.,.,.,H23,.",
          "H23,A5,H23,.,.,.,.,.,H23,A5,H23",
          "H23,A5,A5,H23,H23,H23,H23,H23,A5,A5,H23",
          ".,H23,A5,A5,A5,A5,A5,A5,A5,H23,.",
          ".,H23,A5,H23,A5,A5,A5,H23,A5,H23,.",
          ".,H23,A5,A5,A5,H23,A5,A5,A5,H23,.",
          ".,H23,A5,A5,F3,A5,F3,A5,A5,H23,.",
          ".,.,H23,A5,A5,A5,A5,A5,H23,.,.",
          ".,.,.,H23,A5,A5,A5,H23,.,.,.",
          ".,.,.,.,H23,H23,H23,.,.,.,.",
          ".,.,.,.,.,H23,.,.,.,.,."
        ]
      },
      {
        name: "\ud83d\udc30 \u5154\u53fd",
        width: 9,
        rows: [
          ".,.,H19,H19,.,H19,H19,.,.",
          ".,.,H19,H19,.,H19,H19,.,.",
          ".,.,H19,H19,.,H19,H19,.,.",
          ".,.,H19,H19,.,H19,H19,.,.",
          ".,H19,H19,H19,H19,H19,H19,H19,.",
          "H19,H19,H19,H19,H19,H19,H19,H19,H19",
          "H19,H19,H23,H23,H19,H23,H23,H19,H19",
          "H19,H19,H19,H19,H19,H19,H19,H19,H19",
          "H19,H19,H19,F3,H19,F3,H19,H19,H19",
          "H19,H19,H19,H19,H23,H19,H19,H19,H19",
          ".,H19,H19,H19,H19,H19,H19,H19,.",
          ".,.,H19,H19,H19,H19,H19,.,."
        ]
      },
      {
        name: "\ud83d\udc3c \u718a\u732b",
        width: 10,
        rows: [
          "H23,H23,.,.,.,.,.,.,H23,H23",
          "H23,H23,H23,.,.,.,.,H23,H23,H23",
          ".,H23,H19,H19,H19,H19,H19,H19,H23,.",
          ".,H19,H19,H19,H19,H19,H19,H19,H19,.",
          "H19,H23,H23,H19,H19,H19,H19,H23,H23,H19",
          "H19,H23,H19,H23,H19,H19,H23,H19,H23,H19",
          "H19,H19,H19,H19,H19,H19,H19,H19,H19,H19",
          "H19,H19,H19,H23,H23,H23,H23,H19,H19,H19",
          ".,H19,H19,H19,H19,H19,H19,H19,H19,.",
          ".,.,H19,H19,H19,H19,H19,H19,.,."
        ]
      },
      {
        name: "\ud83d\udc38 \u9752\u86d9",
        width: 10,
        rows: [
          ".,B4,B4,.,.,.,.,B4,B4,.",
          "B4,H19,H19,B4,.,.,B4,H19,H19,B4",
          "B4,H19,H23,B4,.,.,B4,H23,H19,B4",
          ".,B4,B4,B4,B4,B4,B4,B4,B4,.",
          "B4,B4,B4,B4,B4,B4,B4,B4,B4,B4",
          "B4,B4,B4,B4,B4,B4,B4,B4,B4,B4",
          "B4,B4,F10,B4,B4,B4,B4,F10,B4,B4",
          ".,B4,B4,B4,B4,B4,B4,B4,B4,.",
          ".,.,B4,F10,F10,F10,F10,B4,.,.",
          ".,.,.,B4,B4,B4,B4,.,.,."
        ]
      },
      {
        name: "\ud83d\udc27 \u4f01\u9e45",
        width: 9,
        rows: [
          ".,.,.,H23,H23,H23,.,.,.",
          ".,.,H23,H23,H23,H23,H23,.,.",
          ".,H23,H23,H23,H23,H23,H23,H23,.",
          ".,H23,H19,H19,H23,H19,H19,H23,.",
          ".,H23,H19,H23,H23,H23,H19,H23,.",
          "H23,H19,H19,H19,H19,H19,H19,H19,H23",
          "H23,H19,H19,H19,H19,H19,H19,H19,H23",
          ".,H23,H19,H19,H19,H19,H19,H23,.",
          ".,.,H23,H19,H19,H19,H23,.,.",
          ".,.,H23,A11,.,A11,H23,.,.",
          ".,.,A11,A11,.,A11,A11,.,."
        ]
      }
    ]
  },
  {
    id: "pixel-food",
    name: "\ud83c\udf70 \u7f8e\u98df\u751c\u54c1",
    items: [
      {
        name: "\ud83c\udf66 \u51b0\u6dc7\u6dcb",
        width: 7,
        rows: [
          ".,.,F3,F3,F3,.,.",
          ".,F3,F3,F3,F3,F3,.",
          ".,F3,F3,F3,F3,F3,.",
          "F3,F3,F3,F3,F3,F3,F3",
          "F3,F3,F3,F3,F3,F3,F3",
          ".,A5,A5,A5,A5,A5,.",
          ".,A14,A14,A14,A14,A14,.",
          ".,.,A14,A14,A14,.,.",
          ".,.,A14,A14,A14,.,.",
          ".,.,.,A14,.,.,.",
          ".,.,.,A14,.,.,.",
          ".,.,.,A14,.,.,."
        ]
      },
      {
        name: "\ud83c\udf82 \u86cb\u7cd5",
        width: 10,
        rows: [
          ".,.,.,.,A4,A4,.,.,.,.",
          ".,.,.,.,A11,A11,.,.,.,.",
          ".,.,.,.,A11,A11,.,.,.,.",
          ".,F3,F3,F3,F3,F3,F3,F3,F3,.",
          "F3,F3,F3,F3,F3,F3,F3,F3,F3,F3",
          "H19,H19,H19,H19,H19,H19,H19,H19,H19,H19",
          "A14,A14,A14,A14,A14,A14,A14,A14,A14,A14",
          "H19,H19,H19,H19,H19,H19,H19,H19,H19,H19",
          "F15,F15,F15,F15,F15,F15,F15,F15,F15,F15",
          "A14,A14,A14,A14,A14,A14,A14,A14,A14,A14"
        ]
      },
      {
        name: "\ud83c\udf52 \u6a31\u6843",
        width: 8,
        rows: [
          ".,.,.,.,B4,.,.,.",
          ".,.,.,B4,.,.,.,.",
          ".,.,B4,.,.,B4,.,.",
          ".,B4,.,.,.,.,B4,.",
          "B4,.,.,.,.,.,.,B4",
          ".,F10,F10,.,.,F10,F10,.",
          "F10,F10,F10,F10,F10,F10,F10,F10",
          "F10,F10,F10,F10,F10,F10,F10,F10",
          "F10,F10,F10,F10,F10,F10,F10,F10",
          ".,F10,F10,.,.,F10,F10,."
        ]
      },
      {
        name: "\ud83c\udf69 \u751c\u751c\u5708",
        width: 10,
        rows: [
          ".,.,.,A5,A5,A5,A5,.,.,.",
          ".,.,A5,A5,A5,A5,A5,A5,.,.",
          ".,A5,F3,F3,F3,F3,F3,F3,A5,.",
          "A5,F3,A5,A5,A5,A5,A5,A5,F3,A5",
          "A5,F3,A5,.,.,.,.,A5,F3,A5",
          "A5,A5,A5,.,.,.,.,A5,A5,A5",
          "A5,A5,A5,.,.,.,.,A5,A5,A5",
          ".,A5,A5,A5,A5,A5,A5,A5,A5,.",
          ".,.,A5,A5,A5,A5,A5,A5,.,.",
          ".,.,.,A5,A5,A5,A5,.,.,."
        ]
      },
      {
        name: "\ud83c\udf53 \u8349\u8393",
        width: 8,
        rows: [
          ".,.,.,B4,B4,.,.,.",
          ".,.,B4,B4,B4,B4,.,.",
          ".,B4,B4,B4,B4,B4,B4,.",
          ".,.,F10,F10,F10,F10,.,.",
          ".,F10,F10,A4,F10,A4,F10,.",
          "F10,F10,A4,F10,F10,F10,A4,F10",
          "F10,A4,F10,F10,A4,F10,F10,F10",
          "F10,F10,F10,A4,F10,F10,A4,F10",
          ".,F10,A4,F10,F10,A4,F10,.",
          ".,.,F10,F10,F10,F10,.,."
        ]
      }
    ]
  },
  {
    id: "pixel-flower",
    name: "\ud83c\udf38 \u82b1\u5349\u690d\u7269",
    items: [
      {
        name: "\ud83c\udf38 \u6a31\u82b1",
        width: 10,
        rows: [
          ".,.,.,F3,F3,.,.,.,.,.",
          ".,.,F3,F3,F3,.,.,F3,F3,.",
          ".,.,F3,F3,.,.,.,F3,F3,.",
          ".,.,.,F3,F3,A4,F3,F3,.,.",
          ".,F3,F3,A4,A4,A4,A4,F3,F3,.",
          "F3,F3,.,.,A4,A4,.,.,F3,F3",
          "F3,F3,F3,F3,A4,F3,F3,F3,F3,.",
          ".,F3,F3,.,.,.,F3,F3,.,.",
          ".,.,.,.,.,B4,.,.,.,.",
          ".,.,.,.,.,B4,.,.,.,."
        ]
      },
      {
        name: "\ud83c\udf3b \u5411\u65e5\u8475",
        width: 11,
        rows: [
          ".,.,.,A4,A4,.,A4,A4,.,.,.",
          ".,.,A4,A4,.,.,.,A4,A4,.,.",
          ".,A4,A4,.,A13,A13,A13,.,A4,A4,.",
          "A4,A4,.,A13,A13,A13,A13,A13,.,A4,A4",
          "A4,.,A13,A13,A13,A13,A13,A13,A13,.,A4",
          ".,.,A13,A13,A13,A13,A13,A13,A13,.,.",
          "A4,.,A13,A13,A13,A13,A13,A13,A13,.,A4",
          "A4,A4,.,A13,A13,A13,A13,A13,.,A4,A4",
          ".,A4,A4,.,A13,A13,A13,.,A4,A4,.",
          ".,.,A4,A4,.,.,.,A4,A4,.,.",
          ".,.,.,A4,A4,.,A4,A4,.,.,."
        ]
      },
      {
        name: "\ud83c\udf39 \u7403\u7470",
        width: 9,
        rows: [
          ".,.,.,F10,F10,F10,.,.,.",
          ".,.,F10,F10,F10,F10,F10,.,.",
          ".,F10,F10,F5,F5,F10,F10,F10,.",
          ".,F10,F5,F5,F5,F5,F10,F10,.",
          ".,F10,F10,F5,F5,F5,F5,F10,.",
          ".,F10,F10,F10,F5,F10,F10,F10,.",
          ".,.,F10,F10,F10,F10,F10,.,.",
          ".,.,.,.,B4,.,.,.,.",
          ".,.,.,B4,B4,.,.,.,.",
          ".,.,.,.,B4,B4,.,.,.",
          ".,.,.,.,.,B4,.,.,."
        ]
      },
      {
        name: "\ud83c\udf40 \u56db\u53f6\u8349",
        width: 10,
        rows: [
          ".,.,B4,B4,.,.,B4,B4,.,.",
          ".,B4,B4,B4,B4,B4,B4,B4,B4,.",
          "B4,B4,B4,B4,B4,B4,B4,B4,B4,B4",
          "B4,B4,B4,B4,B4,B4,B4,B4,B4,B4",
          ".,B4,B4,B4,B7,B7,B4,B4,B4,.",
          ".,B4,B4,B4,B7,B7,B4,B4,B4,.",
          "B4,B4,B4,B4,B4,B4,B4,B4,B4,B4",
          "B4,B4,B4,B4,B4,B4,B4,B4,B4,B4",
          ".,B4,B4,B4,B4,B4,B4,B4,B4,.",
          ".,.,B4,B4,.,.,B4,B4,.,."
        ]
      },
      {
        name: "\ud83c\udf35 \u4ed9\u4eba\u638c",
        width: 7,
        rows: [
          ".,.,.,B4,.,.,.",
          ".,.,B4,B4,B4,.,.",
          ".,.,B4,B4,B4,.,.",
          "B4,.,B4,B4,B4,.,.",
          "B4,B4,B4,B4,B4,B4,.",
          ".,B4,B4,B4,B4,B4,B4",
          ".,.,B4,B4,B4,B4,B4",
          ".,.,B4,B4,B4,.,.",
          ".,.,B4,B4,B4,.,.",
          ".,A13,A13,A13,A13,A13,.",
          ".,A13,A13,A13,A13,A13,."
        ]
      }
    ]
  },
  {
    id: "pixel-character",
    name: "\ud83c\udf80 \u5361\u901a\u89d2\u8272",
    items: [
      {
        name: "\ud83d\udc7b \u5c0f\u5e7d\u7075",
        width: 8,
        rows: [
          ".,.,H19,H19,H19,H19,.,.",
          ".,H19,H19,H19,H19,H19,H19,.",
          "H19,H19,H19,H19,H19,H19,H19,H19",
          "H19,H19,H23,H23,H19,H23,H23,H19",
          "H19,H19,H23,H23,H19,H23,H23,H19",
          "H19,H19,H19,H19,H19,H19,H19,H19",
          "H19,H19,H19,H19,H19,H19,H19,H19",
          "H19,H19,H19,H19,H19,H19,H19,H19",
          "H19,H19,H19,H19,H19,H19,H19,H19",
          "H19,.,H19,H19,.,H19,H19,."
        ]
      },
      {
        name: "\ud83e\udd16 \u673a\u5668\u4eba",
        width: 10,
        rows: [
          ".,.,.,.,C6,C6,.,.,.,.",
          ".,.,.,.,C6,C6,.,.,.,.",
          ".,.,C6,C6,C6,C6,C6,C6,.,.",
          ".,.,C6,C6,C6,C6,C6,C6,.,.",
          ".,.,C6,H19,C6,C6,H19,C6,.,.",
          ".,.,C6,C6,C6,C6,C6,C6,.,.",
          ".,.,C6,C6,H23,H23,C6,C6,.,.",
          "C6,C6,C6,C6,C6,C6,C6,C6,C6,C6",
          ".,.,C6,C6,C6,C6,C6,C6,.,.",
          ".,.,C6,C6,C6,C6,C6,C6,.,.",
          ".,.,C6,C6,.,.,C6,C6,.,.",
          ".,.,C6,C6,.,.,C6,C6,.,."
        ]
      },
      {
        name: "\ud83c\udf44 \u8611\u83c7",
        width: 9,
        rows: [
          ".,.,.,F10,F10,F10,.,.,.",
          ".,.,F10,F10,F10,F10,F10,.,.",
          ".,F10,F10,H19,F10,H19,F10,F10,.",
          "F10,F10,H19,H19,F10,H19,H19,F10,F10",
          "F10,F10,H19,H19,F10,H19,H19,F10,F10",
          ".,F10,F10,F10,F10,F10,F10,F10,.",
          ".,.,.,E2,E2,E2,.,.,.",
          ".,.,.,E2,E2,E2,.,.,.",
          ".,.,.,E2,E2,E2,.,.,.",
          ".,.,E2,E2,E2,E2,E2,.,."
        ]
      },
      {
        name: "\ud83d\udc51 \u7687\u51a0",
        width: 11,
        rows: [
          ".,A4,.,.,.,A4,.,.,.,A4,.",
          ".,A4,A4,.,A4,A4,A4,.,A4,A4,.",
          ".,A4,A4,A4,A4,A4,A4,A4,A4,A4,.",
          ".,A4,A4,A4,A4,A4,A4,A4,A4,A4,.",
          ".,A4,A4,F10,A4,A4,A4,F10,A4,A4,.",
          ".,A4,A4,A4,A4,A4,A4,A4,A4,A4,.",
          ".,A5,A5,A5,A5,A5,A5,A5,A5,A5,."
        ]
      },
      {
        name: "\ud83d\udc8e \u94bb\u77f3",
        width: 9,
        rows: [
          ".,.,C3,C3,C3,C3,C3,.,.",
          ".,C3,C3,C3,C3,C3,C3,C3,.",
          "C3,C3,C5,C5,C6,C5,C5,C3,C3",
          ".,C3,C5,C6,C6,C6,C5,C3,.",
          ".,.,C5,C6,C6,C6,C5,.,.",
          ".,.,.,C6,C6,C6,.,.,.",
          ".,.,.,C6,C6,C6,.,.,.",
          ".,.,.,.,C6,.,.,.,.",
          ".,.,.,.,C6,.,.,.,.",
          ".,.,.,.,C8,.,.,.,."
        ]
      }
    ]
  }
];
