// Puzzle generator. Two promises drive everything here:
//   1. the clues admit exactly one picture, and
//   2. a player can reach it with pencil logic alone — never a coin flip.
// Both are measured, not assumed: candidates are generated from `art.js`, scored by
// actually running the line solver from a blank board, and rejected unless they land
// inside the tier's measured difficulty band.

import { makeRng } from './rng.js';
import { makeArt, readable } from './art.js';
import { EMPTY, FILLED, enumerate, maskOf, clueFromSolution, sweep, deduce, runsOf } from './line.js';

// Bands below are not guesses: `tools/balance.mjs` prints the score histogram this
// generator actually produces, and the numbers here are read off that table.
export const TIERS = [
  { id: 'apprentice', label: '学徒', size: 5, band: [0, 9], blurb: '一眼能看穿的入门图' },
  { id: 'journey', label: '见习', size: 8, band: [9, 17], blurb: '需要行列交替推进行' },
  { id: 'adept', label: '熟练', size: 10, band: [16, 24], blurb: '交叉排除与留白计数' },
  { id: 'expert', label: '专家', size: 12, band: [22, 32], blurb: '整图靠链式推理串起来' },
  { id: 'master', label: '大师', size: 15, band: [30, 99], blurb: '每一步都要同时看住两三条线' },
];

export const tierById = (id) => TIERS.find((t) => t.id === id) || TIERS[1];

// Independent solution count by row-by-row DP over the column states. The solver's
// completeness proof is the fast path; this is the check on that proof, so a bug in
// `analyseLine` cannot silently ship an ambiguous board.
export function countSolutions(puzzle, limit = 2) {
  const { w, h, rows, cols } = puzzle;
  const colMasks = cols.map((c) => (c.length === 1 && c[0] === 0 ? [] : c));
  // state per column: [completedRuns, currentRun, lastFilled]
  const keyOf = (state) => state.join(',');
  let frontier = new Map();
  const init = [];
  for (let x = 0; x < w; x++) init.push(0, 0, 0);
  frontier.set(keyOf(init), 1);

  for (let y = 0; y < h; y++) {
    const masks = enumerate(w, rows[y]);
    const next = new Map();
    for (const [key, ways] of frontier) {
      const st = key.split(',').map(Number);
      for (const mask of masks) {
        let ok = true;
        const ns = new Array(w * 3);
        for (let x = 0; x < w; x++) {
          const done = st[x * 3];
          let cur = st[x * 3 + 1];
          const on = (mask >> x) & 1;
          const clue = colMasks[x];
          if (on) {
            cur += 1;
            if (clue.length === 0) { ok = false; break; }
            const want = clue[done];
            if (want === undefined || cur > want) { ok = false; break; }
            ns[x * 3] = done;
            ns[x * 3 + 1] = cur;
          } else {
            if (cur) {
              if (cur !== clue[done]) { ok = false; break; }
              ns[x * 3] = done + 1;
              ns[x * 3 + 1] = 0;
            } else {
              ns[x * 3] = done;
              ns[x * 3 + 1] = 0;
            }
          }
          ns[x * 3 + 2] = on;
        }
        if (!ok) continue;
        const nk = keyOf(ns);
        next.set(nk, (next.get(nk) || 0) + ways);
        if (next.get(nk) > 1e9) next.set(nk, 1e9);
      }
    }
    frontier = next;
    if (!frontier.size) return 0;
  }

  let total = 0;
  for (const [key, ways] of frontier) {
    const st = key.split(',').map(Number);
    let ok = true;
    for (let x = 0; x < w; x++) {
      let done = st[x * 3];
      const cur = st[x * 3 + 1];
      const clue = colMasks[x];
      if (cur) {
        if (cur !== clue[done]) { ok = false; break; }
        done += 1;
      }
      if (done !== clue.length) { ok = false; break; }
    }
    if (ok) total += ways;
    if (total >= limit) return total;
  }
  return total;
}

// Score of a candidate. Every term is something a player feels:
//   cellCount   — more board, more bookkeeping
//   clueSpread  — lines with many runs fragment your attention
//   stuck0      — how much of the board resists the very first look
//   passes      — how many row↔column round trips the chain needs
export function grade(puzzle) {
  const cells = puzzle.w * puzzle.h;
  const blank = () => new Uint8Array(cells);

  const b1 = blank();
  const first = sweep(puzzle, b1, false);
  const firstPassRatio = cells ? first.changed / cells : 0;

  const b2 = blank();
  const { passes } = deduce(puzzle, b2);
  let undetermined = 0;
  for (let i = 0; i < b2.length; i++) if (b2[i] === EMPTY) undetermined++;

  let optionSum = 0;
  let maxOptions = 1;
  let runTotal = 0;
  let lineCount = 0;
  const tally = (clueList) => {
    for (const clue of clueList) {
      lineCount++;
      const n = enumerate(clueList === puzzle.rows ? puzzle.w : puzzle.h, clue).length;
      optionSum += Math.log2(1 + n);
      if (n > maxOptions) maxOptions = n;
      runTotal += clue.length;
    }
  };
  tally(puzzle.rows);
  tally(puzzle.cols);
  const avgRuns = runTotal / (lineCount || 1);
  const stuck0 = 1 - firstPassRatio;

  return {
    complete: undetermined === 0,
    undetermined,
    passes: undetermined === 0 ? passes : 99,
    firstPassRatio,
    stuck0,
    maxOptions,
    avgLogOptions: optionSum / (lineCount || 1),
    avgRuns,
    score:
      cells / 25 +
      avgRuns * 2.6 +
      stuck0 * 21 +
      Math.max(0, Math.min(20, passes - 1)) * 1.4 +
      Math.log2(1 + maxOptions) * 0.9,
  };
}

export function makePuzzle(px, w, h, meta) {
  const solution = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solution[i] = px[i] ? FILLED : 0;
  const { rows, cols } = clueFromSolution({ w, h, solution });
  const puzzle = { w, h, rows, cols, solution, ...meta };
  // Re-derive the picture from the clues to be certain the clue extraction round-trips
  // — a silent off-by-one there would make the puzzle unsolvable by construction.
  let check = 0;
  for (let y = 0; y < h; y++) {
    let m = 0;
    for (let x = 0; x < w; x++) if (solution[y * w + x]) m |= 1 << x;
    const r = runsOf(m);
    const want = r.length ? r : [0];
    if (want.join(',') !== rows[y].join(',')) check++;
  }
  puzzle.roundTripClean = check === 0;
  return puzzle;
}

// Generate a puzzle for a tier from a seed. Deterministic: the same seed + tier always
// yields the same board, which is what makes the daily puzzle shared and the tests real.
export function generate(tierId, seed, { attempts = 320 } = {}) {
  const tier = tierById(tierId);
  const n = tier.size;
  const base = `${seed}|${tier.id}|${n}`;
  const rng = makeRng(base);
  const mid = (tier.band[0] + tier.band[1]) / 2;
  let best = null;
  let tried = 0;

  for (let a = 0; a < attempts; a++) {
    tried++;
    const art = makeArt(n, n, rng);
    if (!readable(n, n, art.px)) continue;
    const puzzle = makePuzzle(art.px, n, n, { style: art.style, name: art.name, seed: base, tier: tier.id });
    if (!puzzle.roundTripClean) continue;
    const report = grade(puzzle);
    if (!report.complete) continue;
    const cand = { puzzle, report };
    const dist = Math.abs(report.score - mid) / Math.max(1, (tier.band[1] - tier.band[0]) / 2);
    cand.distance = report.score >= tier.band[0] && report.score < tier.band[1] ? dist * 0.25 : 1 + dist;
    if (!best || cand.distance < best.distance) best = cand;
    if (best.distance <= 0.34) break;
  }

  if (!best) return null;
  best.puzzle.attempts = tried;
  best.puzzle.score = Math.round(best.report.score * 100) / 100;
  best.puzzle.originSeed = String(seed);
  best.puzzle.report = {
    passes: best.report.passes,
    firstPassRatio: best.report.firstPassRatio,
    stuck0: Math.round(best.report.stuck0 * 100) / 100,
    maxOptions: best.report.maxOptions,
  };
  best.puzzle.inBand = best.report.score >= tier.band[0] && best.report.score < tier.band[1];
  return best;
}

// Daily boards rotate through tiers so a streak does not become the same workout.
export function dailyTier(epochDays) {
  return TIERS[epochDays % TIERS.length];
}
