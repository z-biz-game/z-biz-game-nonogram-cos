// Persistence. Everything lives under one key so a reset is one line, and an in-progress
// board is stored as (seed, tier, run-length ink) rather than a copy of the puzzle —
// the generator is deterministic, so the picture never has to travel through storage.

const KEY = 'nonogram.save.v1';

const defaults = () => ({
  settings: { sound: true, autoCross: true, showErrors: true, reduceMotion: false },
  best: {},
  daily: { lastKey: null, streak: 0, solved: [] },
  resume: null,
  totals: { solved: 0, hints: 0, cells: 0, ms: 0 },
});

function rleEncode(board) {
  const out = [];
  let run = board[0] || 0;
  let n = 1;
  for (let i = 1; i < board.length; i++) {
    if (board[i] === run && n < 255) n++;
    else {
      out.push(run, n);
      run = board[i];
      n = 1;
    }
  }
  out.push(run, n);
  return out;
}

function rleDecode(pairs, len) {
  const b = new Uint8Array(len);
  let i = 0;
  for (let p = 0; p < pairs.length; p += 2) {
    const v = pairs[p];
    const n = pairs[p + 1];
    for (let k = 0; k < n && i < len; k++) b[i++] = v;
  }
  return b;
}

// ---- 两段式解码：第一段拿原始记录，第二段逐段净化成可信结构 ------------------
// 判据不是"能不能 parse 过"，而是"一条坏记录丢多少"：丢一条才算过，整局冻死算没做。
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const str = (v, d) => (typeof v === 'string' && v ? v : d);

const sanitizeSettings = (raw) => {
  const d = defaults().settings;
  const s = isObj(raw) ? raw : {};
  return {
    sound: bool(s.sound, d.sound),
    autoCross: bool(s.autoCross, d.autoCross),
    showErrors: bool(s.showErrors, d.showErrors),
    reduceMotion: bool(s.reduceMotion, d.reduceMotion),
  };
};

// best 是"一层一个 tier 的表"：某个 tier 的记录烂掉，只丢那一个 tier。
const sanitizeBest = (raw) => {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [tier, rec] of Object.entries(raw)) {
    if (!isObj(rec)) continue;
    const ms = num(rec.ms, NaN);
    if (!Number.isFinite(ms) || ms > 1e10) continue;
    out[tier] = {
      ms,
      hints: num(rec.hints, 0),
      moves: num(rec.moves, 0),
      size: num(rec.size, 0),
      at: num(rec.at, 0),
    };
  }
  return out;
};

const sanitizeDaily = (raw) => {
  const d = defaults().daily;
  const v = isObj(raw) ? raw : {};
  return {
    lastKey: typeof v.lastKey === 'string' ? v.lastKey : null,
    streak: num(v.streak, d.streak),
    solved: Array.isArray(v.solved) ? v.solved.filter((k) => typeof k === 'string').slice(-90) : [],
  };
};

const sanitizeTotals = (raw) => {
  const d = defaults().totals;
  const v = isObj(raw) ? raw : {};
  return {
    solved: num(v.solved, d.solved),
    hints: num(v.hints, d.hints),
    cells: num(v.cells, d.cells),
    ms: num(v.ms, d.ms),
  };
};

// resume 是"一整局"，任何一项不可信就整条丢掉（丢一条 vs. 冻一局，取前者）。
const CELLS_MAX = 40 * 40;
function sanitizeResume(raw) {
  if (!isObj(raw)) return null;
  const cells = num(raw.cells, 0);
  const ink = Array.isArray(raw.ink) ? raw.ink : null;
  if (!ink || !cells || cells > CELLS_MAX) return null;
  // ink 是 (值, 游程) 成对：值只能是 0/1/2，游程 1..255，长度必须是偶数。
  if (ink.length % 2 || !ink.length) return null;
  for (let i = 0; i < ink.length; i += 2) {
    const v = ink[i];
    const n = ink[i + 1];
    if (v !== 0 && v !== 1 && v !== 2) return null;
    if (!Number.isInteger(n) || n < 1 || n > 255) return null;
  }
  if (!str(raw.seed, '') || !str(raw.tier, '')) return null;
  return {
    seed: raw.seed,
    tier: raw.tier,
    style: str(raw.style, ''),
    name: str(raw.name, '未命名'),
    elapsedMs: num(raw.elapsedMs, 0),
    cells,
    ink,
    moves: num(raw.moves, 0),
    hints: num(raw.hints, 0),
    at: num(raw.at, 0),
  };
}

function load() {
  let parsed = null;
  try {
    const raw = localStorage.getItem(KEY);
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null; // 垃圾 JSON：整份重来，但下面的净化仍会把能认的段落认回来
  }
  if (!isObj(parsed)) parsed = {};
  return {
    settings: sanitizeSettings(parsed.settings),
    best: sanitizeBest(parsed.best),
    daily: sanitizeDaily(parsed.daily),
    totals: sanitizeTotals(parsed.totals),
    resume: sanitizeResume(parsed.resume),
    // 顶层没认出来的键一概不带进内存，避免 {...parsed} 把 '0'/'1' 当键塞进来。
  };
}

export const Store = {
  data: load(),

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* private mode / quota — the game is still playable, just forgetful */
    }
  },

  setting(name) {
    return this.data.settings[name];
  },
  setSetting(name, value) {
    this.data.settings[name] = value;
    this.save();
  },

  best(tier) {
    return this.data.best[tier] || null;
  },
  recordBest(tier, { ms, hints, moves, size }) {
    const cur = this.data.best[tier];
    const better =
      !cur ||
      hints < cur.hints ||
      (hints === cur.hints && (moves < cur.moves || (moves === cur.moves && ms < cur.ms)));
    if (better) this.data.best[tier] = { ms, hints, moves, size, at: Date.now() };
    this.save();
    return better;
  },

  recordSolve(ms, hints) {
    const t = this.data.totals;
    t.solved++;
    t.hints += hints;
    t.ms += ms;
    this.save();
  },

  // Daily streak counts calendar days, so solving twice today must not extend it.
  markDaily(key) {
    const d = this.data.daily;
    if (d.solved.includes(key)) return { streak: d.streak, isNew: false };
    const prev = new Date(d.lastKey + 'T12:00:00');
    const today = new Date(key + 'T12:00:00');
    const gapDays = Math.round((today - prev) / 86400000);
    d.streak = gapDays === 1 ? d.streak + 1 : 1;
    d.lastKey = key;
    d.solved = [...d.solved, key].slice(-90);
    this.save();
    return { streak: d.streak, isNew: true };
  },

  dailySolved(key) {
    return this.data.daily.solved.includes(key);
  },

  saveResume(puzzle, board, elapsedMs, run) {
    this.data.resume = {
      // The generator derives an internal base seed from what it is handed, so a resume
      // has to store the *origin* seed or the rebuilt picture would not be the same one.
      seed: puzzle.originSeed || puzzle.seed,
      tier: puzzle.tier,
      style: puzzle.style,
      name: puzzle.name,
      elapsedMs,
      cells: puzzle.w * puzzle.h,
      ink: rleEncode(board),
      // The cost of the run travels with the board. Without it a player could take six
      // hints, close the tab, come back, and finish with a clean 提示 0 record — the score
      // that decides the best time is counted from strokes, and strokes are not saved.
      moves: run.moves,
      hints: run.hints,
      at: Date.now(),
    };
    this.save();
  },

  resume() {
    // 再净化一次：data.resume 可能来自磁盘，也可能被上一局写坏；坏了就只丢这一局。
    const r = sanitizeResume(this.data.resume);
    if (!r) return null;
    return { ...r, board: rleDecode(r.ink, r.cells) };
  },

  clearResume() {
    this.data.resume = null;
    this.save();
  },

  reset() {
    this.data = defaults();
    this.save();
  },
};
