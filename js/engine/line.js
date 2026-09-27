// The line solver — the whole reason this game never asks the player to guess.
//
// A "line" is one row or column: `len` cells plus its clue, a list of run lengths.
// For a given line we can enumerate *every* bitmask that satisfies the clue, then
// intersect the ones still consistent with what the player already knows. Cells
// present in all surviving masks are provably filled; cells absent from all of them
// are provably empty. That is exactly the reasoning a human does with a pencil, and
// it is sound: any valid solution of the puzzle must appear in the surviving set, so
// anything forced here is forced in every solution.

export const EMPTY = 0;
export const FILLED = 1;
export const CROSS = 2;

const CACHE = new Map();
const RUN_BITS = [0];
for (let i = 1; i < 34; i++) RUN_BITS[i] = (RUN_BITS[i - 1] | (1 << (i - 1))) >>> 0;

export const maskOf = (len) => (len >= 31 ? 0x7fffffff : ((1 << len) - 1) >>> 0);

// Minimum span needed to seat runs[i..] with the mandatory single gaps between them.
function minSpans(runs) {
  const k = runs.length;
  const min = new Int32Array(k + 1);
  for (let i = k - 1; i >= 0; i--) min[i] = runs[i] + (i === k - 1 ? 0 : 1 + min[i + 1]);
  return min;
}

// All bitmasks of width `len` whose runs of 1s are exactly `runs`.
// Clue [0] means "this line is empty" and is normalised to the empty run list.
export function enumerate(len, clue) {
  const runs = clue.length === 1 && clue[0] === 0 ? [] : clue;
  const key = len + ':' + runs.join(',');
  const hit = CACHE.get(key);
  if (hit) return hit;

  const out = [];
  const k = runs.length;
  if (k === 0) out.push(0);
  else {
    const min = minSpans(runs);
    if (min[0] <= len) {
      const rec = (pos, i, mask) => {
        if (i === k) {
          out.push(mask >>> 0);
          return;
        }
        const last = len - min[i];
        for (let start = pos; start <= last; start++) {
          rec(start + runs[i] + 1, i + 1, (mask | (RUN_BITS[runs[i]] << start)) >>> 0);
        }
      };
      rec(0, 0, 0);
    }
  }
  CACHE.set(key, out);
  return out;
}

export function clueOf(runs) {
  return runs.length ? runs : [0];
}

// Reads one line of `board` (row-major, w*h) into the flat array the masks expect.
export function readLine(board, w, h, index, horizontal) {
  const len = horizontal ? w : h;
  const line = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    line[i] = horizontal ? board[index * w + i] : board[i * w + index];
  }
  return line;
}

export function writeLine(board, w, h, index, horizontal, line) {
  for (let i = 0; i < line.length; i++) {
    if (horizontal) board[index * w + i] = line[i];
    else board[i * w + index] = line[i];
  }
}

// Snapshot of what a single line currently proves.
//   status 'solved'  -> every cell determined and the clue is met
//   status 'open'    -> deductions available, nothing forced yet
//   status 'conflict'-> the fixed cells already contradict the clue
export function analyseLine(len, clue, line) {
  const masks = enumerate(len, clue);
  let onBits = 0;
  let offBits = 0;
  for (let i = 0; i < len; i++) {
    if (line[i] === FILLED) onBits |= 1 << i;
    else if (line[i] === CROSS) offBits |= 1 << i;
  }
  onBits >>>= 0;
  offBits >>>= 0;

  let live = 0;
  let andMask = maskOf(len);
  let orMask = 0;
  for (let m = 0; m < masks.length; m++) {
    const mask = masks[m];
    if ((mask & onBits) !== onBits) continue;
    if ((mask & offBits) !== 0) continue;
    live++;
    andMask &= mask;
    orMask |= mask;
  }
  const full = maskOf(len);

  if (live === 0) {
    return { status: 'conflict', live, forcedFill: 0, forcedEmpty: full, options: masks.length };
  }
  let forcedFill = andMask & ~onBits;
  let forcedEmpty = (~orMask & full) & ~offBits;
  forcedFill >>>= 0;
  forcedEmpty >>>= 0;

  let unknown = 0;
  for (let i = 0; i < len; i++) if (line[i] === EMPTY) unknown++;
  const done = unknown === 0 && andMask === orMask && onBits === orMask;

  return {
    status: done ? 'solved' : forcedFill || forcedEmpty ? 'forcing' : 'open',
    live,
    forcedFill,
    forcedEmpty,
    options: masks.length,
  };
}

// Apply every currently-derivable cell in one sweep. Returns whether anything moved
// and, when `trace` is on, a reason per change so the hint UI can explain itself.
export function sweep(puzzle, board, trace) {
  const { w, h, rows, cols } = puzzle;
  let changed = 0;
  const events = trace ? [] : null;

  const pass = (horizontal, count, clueList) => {
    for (let index = 0; index < count; index++) {
      const line = readLine(board, w, h, index, horizontal);
      const a = analyseLine(horizontal ? w : h, clueList[index], line);
      if (a.status === 'conflict') {
        if (trace) events.push({ kind: 'conflict', horizontal, index });
        continue;
      }
      if (!a.forcedFill && !a.forcedEmpty) continue;
      const len = line.length;
      for (let i = 0; i < len; i++) {
        if (line[i] !== EMPTY) continue;
        const bit = 1 << i;
        let to = EMPTY;
        if (a.forcedFill & bit) to = FILLED;
        else if (a.forcedEmpty & bit) to = CROSS;
        if (to === EMPTY) continue;
        line[i] = to;
        changed++;
        if (trace) {
          events.push({
            kind: to === FILLED ? 'fill' : 'cross',
            horizontal,
            index,
            cell: horizontal ? index * w + i : i * w + index,
            rule: a.live === 1 ? '唯一排布' : a.live > 1 ? '交叉排除' : '线索冲突',
            options: a.live,
            clue: clueList[index],
          });
        }
      }
      writeLine(board, w, h, index, horizontal, line);
    }
  };

  pass(true, h, rows);
  pass(false, w, cols);
  return { changed, events };
}

export function deduce(puzzle, board, maxPasses = 200) {
  let passes = 0;
  let all = [];
  for (;;) {
    const r = sweep(puzzle, board, true);
    passes++;
    all = all.concat(r.events);
    if (!r.changed) break;
    if (passes >= maxPasses) break;
  }
  return { passes, events: all };
}

// A board the sweep completes from blank has exactly one solution: each written cell
// was proven to sit in *every* arrangement consistent with the clues, so no second
// solution can survive the same proof.
export function logicSolve(puzzle) {
  const n = puzzle.w * puzzle.h;
  const board = new Uint8Array(n);
  const { passes, events } = deduce(puzzle, board);
  let undetermined = 0;
  for (let i = 0; i < n; i++) if (board[i] === EMPTY) undetermined++;
  return { board, passes, events, complete: undetermined === 0, undetermined };
}

export function isSolved(puzzle, board) {
  const n = puzzle.w * puzzle.h;
  for (let i = 0; i < n; i++) {
    const want = puzzle.solution[i] ? FILLED : CROSS;
    if (board[i] !== want) return false;
  }
  return true;
}

// Does the player's current ink contradict the clue anywhere? Used to explain a loss
// instead of just flashing red, and to refuse a move that can never be part of an
// answer.
export function lineConflicts(puzzle, board) {
  const out = [];
  for (let y = 0; y < puzzle.h; y++) {
    const a = analyseLine(puzzle.w, puzzle.rows[y], readLine(board, puzzle.w, puzzle.h, y, true));
    if (a.status === 'conflict') out.push({ horizontal: true, index: y, clue: puzzle.rows[y] });
  }
  for (let x = 0; x < puzzle.w; x++) {
    const a = analyseLine(puzzle.h, puzzle.cols[x], readLine(board, puzzle.w, puzzle.h, x, false));
    if (a.status === 'conflict') out.push({ horizontal: false, index: x, clue: puzzle.cols[x] });
  }
  return out;
}

export function runsOf(mask) {
  const runs = [];
  let cur = 0;
  let m = mask >>> 0;
  while (m) {
    if (m & 1) cur++;
    else if (cur) {
      runs.push(cur);
      cur = 0;
    }
    m >>>= 1;
  }
  if (cur) runs.push(cur);
  return runs;
}

export function clueFromSolution(puzzle) {
  const rows = [];
  const cols = [];
  for (let y = 0; y < puzzle.h; y++) {
    let m = 0;
    for (let x = 0; x < puzzle.w; x++) if (puzzle.solution[y * puzzle.w + x]) m |= 1 << x;
    rows.push(clueOf(runsOf(m)));
  }
  for (let x = 0; x < puzzle.w; x++) {
    let m = 0;
    for (let y = 0; y < puzzle.h; y++) if (puzzle.solution[y * puzzle.w + x]) m |= 1 << y;
    cols.push(clueOf(runsOf(m)));
  }
  return { rows, cols };
}
