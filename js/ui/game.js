// Game rules and state. Deliberately free of DOM and canvas: the win condition, the
// undo grouping and the contradiction report are all decisions the headless verifier
// makes exactly the same way a player's browser does.

import {
  EMPTY,
  FILLED,
  CROSS,
  analyseLine,
  readLine,
  deduce,
  isSolved,
} from '../engine/line.js';
import { Store } from '../store.js';

// Which clue numbers a human would already have struck off: the longest run-prefix that
// matches the clue from its left (top, for a column).
function matchedPrefix(runs, clue) {
  let m = 0;
  while (m < runs.length && m < clue.length && runs[m] === clue[m]) m++;
  return m;
}

export class Game {
  constructor(puzzle) {
    this.puzzle = puzzle;
    this.board = new Uint8Array(puzzle.w * puzzle.h);
    this.conflictCells = new Uint8Array(puzzle.w * puzzle.h);
    this.history = [];
    this.redone = [];
    this.stroke = null;
    this.hintsUsed = 0;
    this.moves = 0;
    this.closedLines = 0;
    this.announced = new Set();
    this.startedAt = 0;
    this.pausedAt = 0;
    this.pausedTotal = 0;
    this.finishedAt = 0;
    this.view = {
      focus: null,
      hints: new Set(),
      rowState: puzzle.rows.map(() => ({ matched: 0, conflict: false })),
      colState: puzzle.cols.map(() => ({ matched: 0, conflict: false })),
    };
    this.listeners = new Set();
    this.refresh();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // Semantic events, so feedback is driven by "a line just closed" rather than "a
  // number changed" — the difference between rhythm and noise.
  emit(event) {
    for (const fn of this.listeners) fn(event, this);
  }

  start() {
    if (!this.startedAt) this.startedAt = performance.now();
  }

  pause() {
    if (this.pausedAt || this.finishedAt) return;
    this.pausedAt = performance.now();
  }

  resume() {
    if (!this.pausedAt) return;
    this.pausedTotal += performance.now() - this.pausedAt;
    this.pausedAt = 0;
  }

  elapsed(now = performance.now()) {
    if (!this.startedAt) return 0;
    return Math.max(0, (this.finishedAt || now) - this.startedAt - this.pausedTotal);
  }

  remaining() {
    let n = 0;
    for (const r of this.puzzle.rows) n += r.reduce((a, b) => a + b, 0);
    let filled = 0;
    for (let i = 0; i < this.board.length; i++) if (this.board[i] === FILLED) filled++;
    return { need: n, filled };
  }

  progress() {
    const { need, filled } = this.remaining();
    let inked = 0;
    for (let i = 0; i < this.board.length; i++) if (this.board[i] !== EMPTY) inked++;
    return { need, filled, determined: inked, total: this.board.length, ratio: need ? filled / need : 0 };
  }

  lineParts(horizontal, index) {
    const p = this.puzzle;
    const len = horizontal ? p.w : p.h;
    const clue = horizontal ? p.rows[index] : p.cols[index];
    const line = readLine(this.board, p.w, p.h, index, horizontal);
    return { len, clue, line };
  }

  // Recompute contradiction marks and the struck-off clue digits for every line.
  refresh() {
    const p = this.puzzle;
    this.conflictCells.fill(0);
    let anyConflict = false;
    const scan = (horizontal, count, stateList) => {
      for (let index = 0; index < count; index++) {
        const { len, clue, line } = this.lineParts(horizontal, index);
        const a = analyseLine(len, clue, line);
        const conflict = a.status === 'conflict';
        const runs = [];
        let open = -1;
        for (let i = 0; i < len; i++) {
          if (line[i] === FILLED) {
            if (open < 0) open = i;
          } else if (open >= 0) {
            runs.push([open, i - 1]);
            open = -1;
          }
        }
        if (open >= 0) runs.push([open, len - 1]);
        const lengths = runs.map(([s, e]) => e - s + 1);
        if (conflict) {
          anyConflict = true;
          // Blame only the blocks that overstep — a too-long run or one past the end of
          // the clue — so the red says "this block", not "this whole row is wrong".
          runs.forEach(([s, e], r) => {
            if (clue[r] === undefined || e - s + 1 > clue[r]) {
              for (let i = s; i <= e; i++) this.conflictCells[horizontal ? index * p.w + i : i * p.w + index] = 1;
            }
          });
        }
        stateList[index] = {
          matched: conflict ? 0 : matchedPrefix(lengths, clue),
          conflict,
          satisfied: !conflict && lengths.length === clue.length && lengths.every((v, i) => v === clue[i]),
        };
      }
    };
    scan(true, p.h, this.view.rowState);
    scan(false, p.w, this.view.colState);
    this.conflicted = anyConflict;
    return anyConflict;
  }

  beginStroke() {
    if (this.stroke) return;
    this.stroke = [];
  }

  // A drag is one undo step, not thirty. The entry goes into history first, then the
  // stroke stays open while consequences run, so the crosses a closed clue implies append
  // into that same array: one undo takes the ink and its consequences back together, and
  // a win is recorded with the move that caused it already counted.
  endStroke() {
    if (!this.stroke) return;
    const stroke = this.stroke;
    this.stroke = null;
    if (stroke.length) {
      this.history.push(stroke);
      this.redone.length = 0;
      this.moves++;
      this.stroke = stroke;
    }
    this.afterChange();
    this.stroke = null;
    if (stroke.length) this.emit({ type: 'commit' });
  }

  write(cell, value) {
    if (this.board[cell] === value) return false;
    const from = this.board[cell];
    this.board[cell] = value;
    if (this.stroke) this.stroke.push({ cell, from, to: value });
    else this.history.push([{ cell, from, to: value }]);
    return true;
  }

  // Cycle unknown → filled → crossed → unknown for a single tap.
  tap(cell) {
    this.beginStroke();
    const v = this.board[cell];
    const next = v === EMPTY ? FILLED : v === FILLED ? CROSS : EMPTY;
    const ok = this.write(cell, next);
    this.endStroke();
    if (ok) this.emit({ type: next === EMPTY ? 'erase' : next === FILLED ? 'fill' : 'cross', cell });
    return next;
  }

  // paint() closes the stroke only if it opened it: a drag calls this once per cell with
  // the stroke already open, and committing here would make every cell its own undo step.
  paint(cell, value) {
    const owned = !this.stroke;
    this.beginStroke();
    const changed = this.write(cell, value);
    if (owned) this.endStroke();
    else this.refresh();
    if (changed) this.emit({ type: value === FILLED ? 'fill' : value === CROSS ? 'cross' : 'erase', cell });
    return changed;
  }

  // Sound, deducible consequence of a closed clue: once a line's blocks exactly match
  // its clue the leftover cells in that line cannot be ink. Toggleable, because some
  // players want to cross those by hand — and when it is off the crosses really are
  // left to the player, rather than happening anyway behind the setting.
  afterChange() {
    const p = this.puzzle;
    const auto = Store.setting('autoCross');
    const newly = [];
    let guard = 0;
    for (;;) {
      this.refresh();
      const satisfiedNow = new Set();
      const note = (horizontal, index, st) => {
        if (!st.satisfied) return;
        const key = (horizontal ? 'r' : 'c') + index;
        satisfiedNow.add(key);
        if (!this.announced.has(key)) newly.push(key);
      };
      this.view.rowState.forEach((st, i) => note(true, i, st));
      this.view.colState.forEach((st, i) => note(false, i, st));
      this.announced = satisfiedNow;
      if (!newly.length || guard++ > 8) break;
      if (!auto) break;
      let crossed = 0;
      for (const key of newly) {
        if (this.autoCrossLine(key[0] === 'r', Number(key.slice(1)))) crossed++;
      }
      if (!crossed) break;
    }
    this.refresh();
    for (const key of newly) {
      this.closedLines++;
      this.emit({ type: 'lineDone', horizontal: key[0] === 'r', index: Number(key.slice(1)) });
    }
    if (this.conflicted) this.emit({ type: 'conflict' });
    if (!this.finishedAt && isSolved(p, this.board)) {
      this.finishedAt = performance.now();
      this.emit({ type: 'win' });
    }
  }

  autoCrossLine(horizontal, index) {
    const p = this.puzzle;
    const len = horizontal ? p.w : p.h;
    let changed = 0;
    for (let i = 0; i < len; i++) {
      const cell = horizontal ? index * p.w + i : i * p.w + index;
      if (this.board[cell] !== EMPTY) continue;
      // Through write(), so the cross joins the stroke that caused it and a single
      // undo takes the ink and its consequences back together.
      if (this.write(cell, CROSS)) changed++;
    }
    return changed;
  }

  // A clue of "0" means the whole line is empty. That reading is available before the
  // first stroke, so crossing those at setup costs the player nothing.
  prime() {
    const p = this.puzzle;
    const keep = this.stroke;
    // A scratch stroke: these crosses are a reading of the clue, not player input, so
    // they must not become an undo step or make a fresh board look touched.
    this.stroke = [];
    for (let y = 0; y < p.h; y++) if (p.rows[y].length === 1 && p.rows[y][0] === 0) this.autoCrossLine(true, y);
    for (let x = 0; x < p.w; x++) if (p.cols[x].length === 1 && p.cols[x][0] === 0) this.autoCrossLine(false, x);
    this.stroke = keep;
    this.refresh();
  }

  undo() {
    const entry = this.history.pop();
    if (!entry) return false;
    for (let i = entry.length - 1; i >= 0; i--) this.board[entry[i].cell] = entry[i].from;
    this.redone.push(entry);
    this.refresh();
    this.emit({ type: 'undo' });
    this.emit({ type: 'commit' });
    return true;
  }

  redo() {
    const entry = this.redone.pop();
    if (!entry) return false;
    for (const step of entry) this.board[step.cell] = step.to;
    this.history.push(entry);
    this.refresh();
    this.emit({ type: 'fill', cell: entry[entry.length - 1].cell });
    this.emit({ type: 'commit' });
    return true;
  }

  // A hint is not "here is a cell": it runs the same line solver the puzzle was graded
  // with, so the suggestion is provably derivable and the explanation names the rule.
  hint() {
    const p = this.puzzle;
    const probe = this.board.slice();
    const { events } = deduce(p, probe);
    this.view.hints.clear();
    const fresh = events.filter((e) => e.kind !== 'conflict');
    let pick = fresh.find((e) => e.kind === 'fill' && this.board[e.cell] === EMPTY);
    if (!pick) pick = fresh.find((e) => this.board[e.cell] === EMPTY);
    if (!pick) {
      const still = [];
      for (let i = 0; i < probe.length; i++) if (probe[i] === EMPTY) still.push(i);
      if (!still.length) return null;
      return { text: '这一步不能白给：先核对上面标红的行列线索。', cells: [], forced: false };
    }
    for (const e of fresh.slice(0, 10)) if (e.cell !== undefined) this.view.hints.add(e.cell);
    this.hintsUsed++;
    const cell = pick.cell;
    this.beginStroke();
    this.write(cell, pick.kind === 'fill' ? FILLED : CROSS);
    this.endStroke();
    this.emit({ type: 'hint', cell });
    const label = pick.horizontal ? `第 ${pick.index + 1} 行` : `第 ${pick.index + 1} 列`;
    return {
      text: `${label} 线索 ${pick.clue.join(' ')} → 只剩 ${pick.options} 种排布，${pick.kind === 'fill' ? '此格必填' : '此格必空'}`,
      cells: [cell],
      line: { horizontal: pick.horizontal, index: pick.index },
      forced: pick.options === 1,
    };
  }

  clearHints() {
    this.view.hints.clear();
  }

  focusLine(horizontal, index) {
    const f = this.view.focus;
    this.view.focus = f && f.horizontal === horizontal && f.index === index ? null : { horizontal, index };
  }

  reset() {
    this.board.fill(EMPTY);
    this.history.length = 0;
    this.redone.length = 0;
    this.hintsUsed = 0;
    this.moves = 0;
    this.closedLines = 0;
    this.announced = new Set();
    this.startedAt = 0;
    this.pausedAt = 0;
    this.pausedTotal = 0;
    this.finishedAt = 0;
    this.view.hints.clear();
    this.view.focus = null;
    this.view.cursor = null;
    this.prime();
    this.start();
  }
}
