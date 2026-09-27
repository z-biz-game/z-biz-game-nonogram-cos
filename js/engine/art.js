// Procedural pixel silhouettes. A nonogram's payoff is the picture it prints, and
// uniform random cells print television static — so motifs are composed from shapes
// with mirror symmetry, then filtered by the same measurements the UI reports.

const NAME_HEAD = ['苔原', '熔金', '深海', '霜语', '古铜', '微光', '赤霄', '流萤', '苍梧', '静谧', '纸间', '拓月'];
const NAME_TAIL = ['水母', '罗盘', '纸鸢', '灯塔', '石鲸', '算珠', '伞塔', '星轨', '蘑菇', '茶壶', '藤椅', '帆船', '琥珀', '铜铃'];

export const STYLES = ['creature', 'totem', 'kaleido', 'coast', 'medallion'];

function surface(w, h) {
  const px = new Uint8Array(w * h);
  return {
    w,
    h,
    px,
    set(x, y, v = 1) {
      x = Math.round(x);
      y = Math.round(y);
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      px[y * w + x] = v;
    },
    get(x, y) {
      return x < 0 || y < 0 || x >= w || y >= h ? 0 : px[y * w + x];
    },
    rect(x0, y0, x1, y1, v = 1) {
      for (let y = Math.round(y0); y <= Math.round(y1); y++)
        for (let x = Math.round(x0); x <= Math.round(x1); x++) this.set(x, y, v);
    },
    ellipse(cx, cy, rx, ry, v = 1) {
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          const dx = (x - cx) / (rx + 0.001);
          const dy = (y - cy) / (ry + 0.001);
          if (dx * dx + dy * dy <= 1.02) this.set(x, y, v);
        }
    },
    diamond(cx, cy, rx, ry, v = 1) {
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          if (Math.abs((x - cx) / (rx + 0.001)) + Math.abs((y - cy) / (ry + 0.001)) <= 1.02) this.set(x, y, v);
        }
    },
    // Point-up isoceles triangle: apex at (cx, yTop), base spanning [x0,x1] at yBase.
    triangle(cx, yTop, x0, x1, yBase, v = 1) {
      for (let y = yTop; y <= yBase; y++) {
        const t = yBase === yTop ? 1 : (y - yTop) / (yBase - yTop);
        const half = ((x1 - x0) / 2) * t;
        this.rect(cx - half, y, cx + half, y, v);
      }
    },
    ring(cx, cy, r, thickness, v = 1) {
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
          const d = Math.hypot(x - cx, y - cy);
          if (d <= r + 0.35 && d >= r - thickness) this.set(x, y, v);
        }
    },
    clear() {
      px.fill(0);
    },
  };
}

function mirrorH(s) {
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++) {
      const src = Math.min(x, s.w - 1 - x);
      s.px[y * s.w + x] = s.px[y * s.w + src];
    }
}

function mirrorV(s) {
  for (let y = 0; y < s.h; y++) {
    const src = Math.min(y, s.h - 1 - y);
    for (let x = 0; x < s.w; x++) s.px[y * s.w + x] = s.px[src * s.w + x];
  }
}

function carveRow(s, y, from, to) {
  for (let x = from; x <= to; x++) s.set(x, y, 0);
}

// A ridge line, used by the coast style so horizons are not ruler-straight.
function ridge(s, y0, amp, phase, v = 1) {
  for (let x = 0; x < s.w; x++) {
    const wob = Math.round(amp * Math.sin((x + phase) * 0.9) + amp * 0.5 * Math.sin((x + phase) * 0.31));
    for (let y = y0 + wob; y < s.h; y++) s.set(x, y, v);
  }
}

export function makeArt(w, h, rng) {
  const style = rng.pick(STYLES);
  const s = surface(w, h);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;

  if (style === 'creature') {
    const bodyR = rng.range(Math.max(1, Math.round(w * 0.22)), Math.max(2, Math.round(w * 0.34)));
    const bodyY = Math.round(h * rng.range(0.5, 0.62));
    s.ellipse(cx, bodyY, bodyR, Math.max(1, Math.round(bodyR * rng.range(7, 11) / 10)));
    if (rng.chance(0.75)) {
      const headR = Math.max(1, Math.round(bodyR * 0.62));
      s.ellipse(cx, bodyY - bodyR - headR * 0.4, headR, headR);
    }
    const legs = rng.range(1, 3);
    for (let i = 0; i < legs; i++) {
      const off = Math.round((i + 1) * bodyR * rng.range(4, 7) / 10);
      s.rect(cx - off, bodyY + 1, cx - off, h - 1);
      s.rect(cx + off, bodyY + 1, cx + off, h - 1);
    }
    if (rng.chance(0.55)) {
      const arm = Math.max(1, Math.round(bodyR * 0.4));
      s.ellipse(cx - bodyR - arm * 0.5, bodyY - 1, arm, Math.max(1, arm * 0.7));
      s.ellipse(cx + bodyR + arm * 0.5, bodyY - 1, arm, Math.max(1, arm * 0.7));
    }
    mirrorH(s);
    if (w >= 6 && rng.chance(0.8)) {
      const ey = Math.max(1, Math.round(cx - bodyR * 0.34));
      const oy = Math.min(h - 2, Math.max(0, bodyY - bodyR));
      carveRow(s, oy, ey - 1, ey);
      carveRow(s, oy, w - 1 - ey, w - ey);
    }
  } else if (style === 'totem') {
    const bands = rng.range(3, 5);
    let y = 0;
    for (let i = 0; i < bands; i++) {
      const bh = Math.max(1, Math.round((h - y) / (bands - i)));
      const inset = rng.range(0, Math.max(0, Math.round(w * 0.18)));
      const kind = rng.int(3);
      if (kind === 0) s.rect(inset, y, w - 1 - inset, y + bh - 1);
      else if (kind === 1) s.diamond(cx, y + (bh - 1) / 2, (w - 1) / 2 - inset, (bh - 1) / 2);
      else {
        s.triangle(cx, y, inset, w - 1 - inset, y + bh - 1);
      }
      y += bh;
    }
    mirrorH(s);
    if (rng.chance(0.45)) mirrorV(s);
    if (w >= 7 && rng.chance(0.7)) {
      const hy = rng.range(1, Math.max(1, h - 2));
      carveRow(s, hy, Math.round(cx - 1), Math.round(cx));
    }
  } else if (style === 'kaleido') {
    const r = Math.max(1, Math.round(Math.min(w, h) * rng.range(34, 48) / 100));
    const spokes = rng.range(4, 8);
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r * (h / w);
      if (i % 2 === 0) s.ellipse(px, py, Math.max(1, r * 0.42), Math.max(1, r * 0.42));
      else s.rect(px, py, px, py);
    }
    s.ring(cx, cy, r, Math.max(1, Math.round(r * 0.3)));
    s.ellipse(cx, cy, Math.max(1, r * 0.45), Math.max(1, r * 0.45));
    mirrorH(s);
    mirrorV(s);
  } else if (style === 'coast') {
    const sunR = Math.max(1, Math.round(Math.min(w, h) * rng.range(14, 26) / 100));
    s.ellipse(rng.range(Math.round(w * 0.2), Math.round(w * 0.8)), rng.range(1, Math.max(1, Math.round(h * 0.35))), sunR, sunR);
    const peaks = rng.range(2, 4);
    const baseY = Math.round(h * rng.range(0.45, 0.6));
    for (let i = 0; i < peaks; i++) {
      const px = Math.round(((i + 0.5) / peaks) * (w - 1));
      const ph = Math.max(1, Math.round(h * rng.range(14, 34) / 100));
      const pw = Math.max(1, Math.round(w / peaks / 2) + rng.range(0, 1));
      s.triangle(px, baseY - ph, px - pw, px + pw, baseY);
    }
    mirrorH(s);
    ridge(s, Math.round(h * rng.range(0.62, 0.78)), Math.max(1, Math.round(h * 0.06)), rng.int(w));
  } else {
    const r = Math.max(1, Math.round(Math.min(w, h) * rng.range(38, 48) / 100));
    s.ring(cx, cy, r, Math.max(1, Math.round(r * 0.34)));
    s.diamond(cx, cy, Math.max(1, r - 2), Math.max(1, r - 2));
    if (rng.chance(0.6)) s.ellipse(cx, cy, Math.max(1, r * 0.35), Math.max(1, r * 0.35), 0);
    const n = rng.range(4, 8);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.3;
      s.set(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    mirrorH(s);
  }

  return { px: s.px.slice(), style, name: rng.pick(NAME_HEAD) + rng.pick(NAME_TAIL) };
}

// ---- aesthetic measurements -------------------------------------------------

export function fillRatio(px) {
  let n = 0;
  for (let i = 0; i < px.length; i++) n += px[i] ? 1 : 0;
  return n / px.length;
}

// Size of the largest 4-connected blob as a share of all ink. Below ~0.55 the board
// reads as confetti rather than as one object.
export function cohesion(w, h, px) {
  const seen = new Uint8Array(w * h);
  let best = 0;
  let total = 0;
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (!px[start] || seen[start]) continue;
    let top = 0;
    let size = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top) {
      const c = stack[--top];
      size++;
      const x = c % w;
      const y = (c / w) | 0;
      if (x > 0 && px[c - 1] && !seen[c - 1]) { seen[c - 1] = 1; stack[top++] = c - 1; }
      if (x < w - 1 && px[c + 1] && !seen[c + 1]) { seen[c + 1] = 1; stack[top++] = c + 1; }
      if (y > 0 && px[c - w] && !seen[c - w]) { seen[c - w] = 1; stack[top++] = c - w; }
      if (y < h - 1 && px[c + w] && !seen[c + w]) { seen[c + w] = 1; stack[top++] = c + w; }
    }
    if (size > best) best = size;
  }
  for (let i = 0; i < px.length; i++) total += px[i] ? 1 : 0;
  return total ? best / total : 0;
}

// A clue made mostly of 1s is fiddly to read and ugly to solve; count them.
export function singleRatio(w, h, px) {
  let ones = 0;
  let clues = 0;
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x <= w; x++) {
      const v = x < w ? px[y * w + x] : 0;
      if (v) run++;
      else if (run) { ones += run === 1 ? 1 : 0; clues++; run = 0; }
    }
  }
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = 0; y <= h; y++) {
      const v = y < h ? px[y * w + x] : 0;
      if (v) run++;
      else if (run) { ones += run === 1 ? 1 : 0; clues++; run = 0; }
    }
  }
  return clues ? ones / clues : 0;
}

export function readable(w, h, px) {
  const f = fillRatio(px);
  return f >= 0.24 && f <= 0.7 && cohesion(w, h, px) >= 0.5 && singleRatio(w, h, px) <= 0.72;
}
