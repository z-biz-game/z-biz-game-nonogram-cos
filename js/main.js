// Boot + wiring. The screens, the input plumbing and one deliberate extra: a
// `window.nonogram` handle that drives the very same code paths a finger does, so
// tools/verify.sh can assert against real play rather than against a test-only mock.

import { applyThemeVars, Motion, prefersReducedMotion, setReduceMotion } from './theme.js';
applyThemeVars();

import { Store } from './store.js';
import { audio } from './audio/synth.js';
import { TIERS, tierById, dailyTier, generate, grade, countSolutions } from './engine/generate.js';
import { dateSeed } from './engine/rng.js';
import {
  EMPTY, FILLED, CROSS,
  enumerate, analyseLine, deduce, sweep, readLine, isSolved, clueFromSolution,
} from './engine/line.js';
import { Game } from './ui/game.js';
import { BoardView } from './render/board.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

const fmtTime = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
};

const STYLE_LABEL = {
  creature: '生灵', totem: '图腾', kaleido: '万花', coast: '山海', medallion: '徽章',
};

const ui = {
  menu: $('#screen-menu'),
  game: $('#screen-game'),
  win: $('#screen-win'),
  canvas: $('#board'),
  boardWrap: $('#board-wrap'),
  tierGrid: $('#tier-grid'),
  hudName: $('#hud-name'),
  hudTier: $('#hud-tier'),
  hudProgress: $('#hud-progress'),
  hudTime: $('#hud-time'),
  fill: $('#progress-fill'),
  rail: $('.progress-rail'),
  status: $('#statusline'),
  hintCount: $('#hint-count'),
  undo: $('#btn-undo'),
  redo: $('#btn-redo'),
  toasts: $('#toast-host'),
  dailyKey: $('#daily-key'),
  dailyNote: $('#daily-note'),
  resumeCard: $('#resume-card'),
  resumeName: $('#resume-name'),
  resumeTier: $('#resume-tier'),
};

let game = null;
let view = null;
let mode = 'paint';
let drag = null;
let cursor = { x: 0, y: 0 };
let needsDraw = true;
let lastSecond = -1;
let saveTimer = 0;
let session = { tier: 'journey', seedSeed: null, dailyKey: null };

// ---------------------------------------------------------------- toasts / status
function toast(text, kind = '', ms = 2100) {
  const t = el('div', 'toast' + (kind ? ' ' + kind : ''), text);
  ui.toasts.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), Motion.base);
  }, ms);
  while (ui.toasts.children.length > 3) ui.toasts.firstChild.remove();
}

function status(html, kind = '') {
  ui.status.className = 'statusline' + (kind ? ' is-' + kind : '');
  ui.status.innerHTML = html;
}

// WebAudio and navigator.vibrate are both gated by user activation: firing them before the
// first tap does nothing and logs a console error per event, which buries the errors that
// matter. One capture-phase listener opens both.
function markActivation() {
  // Ask the browser rather than assuming the event was a human: a synthetic PointerEvent
  // reaches this listener too, and unlocking against it only produces the warning this
  // gate exists to avoid.
  const ua = navigator.userActivation;
  if (ua && !ua.hasBeenActive) return;
  audio.unlock();
}
window.addEventListener('pointerdown', markActivation, { capture: true, passive: true });
window.addEventListener('keydown', markActivation, { capture: true });

function haptic(kind) {
  const ua = navigator.userActivation;
  if (!navigator.vibrate || (ua && !ua.hasBeenActive)) return;
  navigator.vibrate(kind === 'bad' ? [14, 40, 14] : kind === 'big' ? 26 : 8);
}

// ---------------------------------------------------------------- screens
function show(name) {
  for (const s of [ui.menu, ui.game, ui.win]) s.hidden = s.dataset.screen !== name;
  needsDraw = true;
  if (name !== 'game') flushResume();
}

// ---------------------------------------------------------------- menu
function renderMenu() {
  ui.tierGrid.textContent = '';
  for (const tier of TIERS) {
    const btn = el('button', 'tier');
    btn.type = 'button';
    btn.dataset.tier = tier.id;
    btn.append(el('span', 'tier-name', tier.label));
    btn.append(el('span', 'tier-size', `${tier.size} × ${tier.size}`));
    btn.append(el('span', 'tier-blurb', tier.blurb));
    const best = Store.best(tier.id);
    btn.append(el('span', 'tier-best', best ? `最佳 ${fmtTime(best.ms)}${best.hints ? ` · ${best.hints} 求助` : ''}` : '未挑战'));
    btn.addEventListener('click', () => startTier(tier.id));
    ui.tierGrid.appendChild(btn);
  }

  const { key } = dateSeed();
  ui.dailyKey.textContent = key;
  const done = Store.dailySolved(key);
  ui.dailyNote.textContent = done ? '今日已完成，明天再来。' : '全服同一张图，按日期种子生成。';
  $('#btn-daily').textContent = done ? '回顾' : '开始';

  $('#st-solved').textContent = Store.data.totals.solved;
  $('#st-streak').textContent = Store.data.daily.streak;
  $('#st-time').textContent = fmtTime(Store.data.totals.ms);
  $('#st-hints').textContent = Store.data.totals.hints;

  const r = Store.resume();
  if (r) {
    ui.resumeCard.hidden = false;
    ui.resumeTier.textContent = tierById(r.tier).label;
    ui.resumeName.textContent = `${r.name} · 已用 ${fmtTime(r.elapsedMs)}`;
  } else {
    ui.resumeCard.hidden = true;
  }

  for (const [id, name] of [['opt-sound', 'sound'], ['opt-autocross', 'autoCross'], ['opt-errors', 'showErrors']]) {
    $('#' + id).checked = !!Store.setting(name);
  }
  $('#opt-motion').checked = prefersReducedMotion() || !!Store.setting('reduceMotion');
  applySound(Store.setting('sound') !== false);
}

// ---------------------------------------------------------------- start / resume
async function begin({ tier, seed, dailyKey, puzzle: given, restore }) {
  session.tier = tier;
  session.dailyKey = dailyKey || null;
  show('game');
  status('<b>正在出题…</b> 生成器要用求解器验一遍唯一解');
  ui.hudName.textContent = '…';
  ui.hudTier.textContent = tierById(tier).label;
  await new Promise((r) => requestAnimationFrame(() => r()));

  let puzzle = given || null;
  if (!puzzle) {
    let made = generate(tier, seed);
    if (!made) {
      // The generator scores candidates with the same solver that proves the board is
      // guess-free, so a miss means the seed found nothing inside its budget. Fall back
      // to the easiest tier rather than ship a board nobody can finish with a pencil.
      made = generate('apprentice', seed + '#fallback');
      if (!made) {
        status('这台设备上没能生成棋局，稍后再试。', 'bad');
        return null;
      }
      toast('该种子没有达标图，已换一张入门图');
    }
    puzzle = made.puzzle;
  }

  game = new Game(puzzle);
  view = new BoardView(ui.canvas);
  if (restore) {
    game.board.set(restore.board);
    game.startedAt = performance.now() - (restore.elapsedMs || 0);
    // The picture came back; so must its cost. A resumed run that counted from zero would
    // report fewer 提示 than it took, and 提示 is what decides a best time.
    game.moves = restore.moves || 0;
    game.hintsUsed = restore.hints || 0;
  }
  // Clue-0 lines are readable before the first stroke, so they arrive pre-crossed on a
  // fresh board; on a resumed one the crosses are already in the saved ink.
  game.prime();
  if (!restore) game.start();
  resize();
  wireGameEvents();
  ui.hudName.textContent = puzzle.name;
  ui.hudTier.textContent = `${tierById(tier).label} ${puzzle.w}×${puzzle.h} · 难度分 ${puzzle.score}`;
  ui.undo.disabled = true;
  ui.redo.disabled = true;
  status('用行列线索推出整张图。<b>本局可纯逻辑解出</b>，不需要猜。');
  lastSecond = -1;
  syncHud();
  needsDraw = true;
  return game;
}

function startTier(tier, opts = {}) {
  const seed = opts.seed || `${tier}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  return begin({ tier, seed });
}

function startDaily() {
  const { key, epochDays } = dateSeed();
  return begin({ tier: dailyTier(epochDays).id, seed: `daily|${key}`, dailyKey: key });
}

function flushResume() {
  clearTimeout(saveTimer);
  // moves, not history.length: a stroke only reaches history when it closes, so a
  // length check here silently skips the very first move of every board.
  if (!game || game.finishedAt || !game.moves) return;
  Store.saveResume(game.puzzle, game.board, game.elapsed(), { moves: game.moves, hints: game.hintsUsed });
}

function persistResume() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushResume, 400);
}

// ---------------------------------------------------------------- HUD
function syncHud() {
  if (!game) return;
  const pr = game.progress();
  const pct = Math.round(pr.ratio * 100);
  ui.hudProgress.innerHTML = `<b>${pct}%</b>`;
  ui.fill.style.width = pct + '%';
  ui.rail.classList.toggle('is-done', pct >= 100);
  ui.hintCount.textContent = game.hintsUsed;
  ui.undo.disabled = !game.history.length;
  ui.redo.disabled = !game.redone.length;
}

function loop(now) {
  requestAnimationFrame(loop);
  if (ui.game.hidden || !game || !view) return;
  const secs = Math.floor(game.elapsed(now) / 1000);
  if (secs !== lastSecond) {
    lastSecond = secs;
    ui.hudTime.textContent = fmtTime(game.elapsed(now));
  }
  const animating = view.animating(now);
  if (needsDraw || animating) {
    view.render(game, now);
    needsDraw = false;
  }
}

function resize() {
  if (!game || !view) return;
  const pad = 8;
  view.layout(game.puzzle, ui.boardWrap.clientWidth - pad, Math.min(ui.boardWrap.clientHeight || 640, window.innerHeight * 0.66));
  needsDraw = true;
}

// ---------------------------------------------------------------- game events
function wireGameEvents() {
  game.on((e, g) => {
    if (e.type === 'fill' || e.type === 'cross' || e.type === 'erase') {
      view.pulse(e.cell, e.type === 'fill' ? 'fill' : 'cross', performance.now());
      if (e.type === 'fill') audio.fill();
      else if (e.type === 'cross') audio.cross();
      else audio.erase();
      haptic('light');
      needsDraw = true;
      syncHud();
    } else if (e.type === 'commit') {
      // One write per move, not per cell: the board a resume record must reproduce only
      // exists once the stroke has closed and taken its auto-crosses with it.
      persistResume();
    } else if (e.type === 'lineDone') {
      view.lineComplete(e.horizontal, e.index, performance.now());
      audio.lineDone();
      haptic('big');
      needsDraw = true;
      const label = e.horizontal ? `第 ${e.index + 1} 行` : `第 ${e.index + 1} 列`;
      status(`<b>${label}</b> 线索闭合，多余格自动打叉。`);
    } else if (e.type === 'conflict') {
      audio.error();
      haptic('bad');
      ui.boardWrap.classList.remove('shake');
      void ui.boardWrap.offsetWidth;
      ui.boardWrap.classList.add('shake');
      const bad = [];
      g.view.rowState.forEach((s, i) => s.conflict && bad.push(`第 ${i + 1} 行`));
      g.view.colState.forEach((s, i) => s.conflict && bad.push(`第 ${i + 1} 列`));
      status(`红色那一块超出线索装得下的长度：<b>${bad.join('、')}</b> 正在打架。涂格数与数字对不上时，先想哪一段必须挪走。`, 'bad');
    } else if (e.type === 'hint') {
      audio.hint();
      syncHud();
      needsDraw = true;
    } else if (e.type === 'undo') {
      syncHud();
      needsDraw = true;
      audio.erase();
    } else if (e.type === 'win') {
      onWin();
    }
  });
}

function onWin() {
  const g = game;
  const p = g.puzzle;
  const ms = g.elapsed();
  const report = p.report || {};
  const better = Store.recordBest(p.tier, { ms, hints: g.hintsUsed, moves: g.moves, size: p.w });
  Store.data.totals.cells = (Store.data.totals.cells || 0) + p.solution.reduce((a, b) => a + (b ? 1 : 0), 0);
  Store.recordSolve(ms, g.hintsUsed);
  let dailyLine = '';
  if (session.dailyKey) {
    const r = Store.markDaily(session.dailyKey);
    dailyLine = ` · 今日连续 <b>${r.streak}</b> 天`;
  }
  Store.clearResume();
  view.beginWin(performance.now());
  audio.win();
  haptic('big');
  needsDraw = true;

  setTimeout(() => {
    $('#win-tag').textContent = better ? '新纪录' : '完成';
    $('#win-tag').className = 'chip ' + (better ? 'chip-good' : 'chip-accent');
    $('#win-name').textContent = p.name;
    $('#win-style').textContent = `${STYLE_LABEL[p.style] || p.style} · ${p.w}×${p.h} · ${tierById(p.tier).label}`;
    $('#win-time').textContent = fmtTime(ms);
    $('#win-moves').textContent = g.moves;
    $('#win-hints').textContent = g.hintsUsed;
    $('#win-score').textContent = p.score;
    $('#win-note').innerHTML = better
      ? `刷新了 ${tierById(p.tier).label} 的最佳成绩${dailyLine}`
      : `用时 ${fmtTime(ms)}，求助 ${g.hintsUsed} 次${dailyLine}`;
    $('#win-passes').textContent = (report.passes ?? '—') + ' 次';
    $('#win-first').textContent = report.firstPassRatio ? Math.round(report.firstPassRatio * 100) + '%' : '—';
    show('win');
    renderMenu();
  }, Motion.win + p.w * 30);
}

// ---------------------------------------------------------------- input
function paintValue(ev) {
  if (ev.button === 2 || ev.buttons === 2) return CROSS;
  if (ev.button === 1 || ev.shiftKey) return EMPTY;
  if (mode === 'mark') return CROSS;
  if (mode === 'cycle') return null;
  return FILLED;
}

ui.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

ui.canvas.addEventListener('pointerdown', (ev) => {
  if (!game || game.finishedAt) return;
  ev.currentTarget.setPointerCapture(ev.pointerId);
  const rect = ui.canvas.getBoundingClientRect();
  const hit = view.hitTest(ev.clientX - rect.left, ev.clientY - rect.top);
  if (!hit) return;
  if (hit.clue) {
    game.focusLine(hit.horizontal, hit.index);
    const clue = hit.horizontal ? game.puzzle.rows[hit.index] : game.puzzle.cols[hit.index];
    status(`聚焦 <b>${hit.horizontal ? '第 ' + (hit.index + 1) + ' 行' : '第 ' + (hit.index + 1) + ' 列'}</b> · 线索 ${clue.join(' ')}`);
    needsDraw = true;
    return;
  }
  cursor = { x: hit.x, y: hit.y };
  game.view.cursor = { ...cursor };
  const value = paintValue(ev);
  ui.canvas.classList.add('grabbing');
  if (value === null) {
    game.tap(hit.cell);
    drag = { cell: hit.cell, value: null, moved: false };
  } else {
    game.beginStroke();
    drag = { cell: hit.cell, value, moved: false, pointerType: ev.pointerType, timer: 0 };
    if (ev.pointerType === 'touch') {
      // Long-press is the "other hand" on a phone: whatever the segment control says,
      // holding down flips to the opposite mark instead of waiting for a mode switch.
      drag.timer = setTimeout(() => {
        if (!drag || drag.moved) return;
        drag.value = drag.value === FILLED ? CROSS : FILLED;
        game.paint(drag.cell, drag.value);
        toast(drag.value === CROSS ? '长按 → 打叉' : '长按 → 涂格');
      }, 380);
    }
    game.paint(hit.cell, value);
  }
  needsDraw = true;
});

ui.canvas.addEventListener('pointermove', (ev) => {
  if (!game || !drag) return;
  const rect = ui.canvas.getBoundingClientRect();
  const hit = view.hitTest(ev.clientX - rect.left, ev.clientY - rect.top);
  if (!hit || hit.cell === undefined) return;
  if (hit.cell === drag.cell) return;
  drag.moved = true;
  clearTimeout(drag.timer);
  drag.cell = hit.cell;
  if (drag.value !== null) game.paint(hit.cell, drag.value);
  needsDraw = true;
});

const endDrag = () => {
  if (!game || !drag) return;
  clearTimeout(drag.timer);
  if (drag.value !== null) game.endStroke();
  drag = null;
  ui.canvas.classList.remove('grabbing');
  needsDraw = true;
};
ui.canvas.addEventListener('pointerup', endDrag);
ui.canvas.addEventListener('pointercancel', endDrag);
window.addEventListener('pointerup', endDrag);

// Keyboard play: arrows only move the marker, space commits. Painting on every arrow
// press would turn navigation into input and make undo meaningless.
window.addEventListener('keydown', (ev) => {
  if (ui.game.hidden || !game) return;
  const p = game.puzzle;
  const k = ev.key.toLowerCase();
  const move = (dx, dy) => {
    ev.preventDefault();
    cursor.x = Math.max(0, Math.min(p.w - 1, cursor.x + dx));
    cursor.y = Math.max(0, Math.min(p.h - 1, cursor.y + dy));
    game.view.cursor = { ...cursor };
    needsDraw = true;
  };
  if (k === 'arrowleft') move(-1, 0);
  else if (k === 'arrowright') move(1, 0);
  else if (k === 'arrowup') move(0, -1);
  else if (k === 'arrowdown') move(0, 1);
  else if (k === ' ' || k === 'enter') {
    ev.preventDefault();
    game.tap(cursor.y * p.w + cursor.x);
    needsDraw = true;
  } else if (k === 'z') game.undo();
  else if (k === 'y') game.redo();
  else if (k === 'h') useHint();
  else if (k === 'escape') { show('menu'); renderMenu(); }
});

function useHint() {
  if (!game || game.finishedAt) return;
  const h = game.hint();
  if (!h) {
    status('已经推到底了 —— 剩下的格子没有未知数。', 'good');
    return;
  }
  status(h.text + (h.forced ? ' <b>（唯一排布）</b>' : ''), 'good');
  if (h.line) game.focusLine(h.line.horizontal, h.line.index);
  needsDraw = true;
  syncHud();
}

// ---------------------------------------------------------------- controls
$('#btn-back').addEventListener('click', () => {
  show('menu');
  renderMenu();
});
$('#btn-undo').addEventListener('click', () => game && game.undo());
$('#btn-redo').addEventListener('click', () => game && game.redo());
$('#btn-hint').addEventListener('click', useHint);
$('#btn-clear').addEventListener('click', () => {
  if (!game) return;
  game.reset();
  syncHud();
  needsDraw = true;
  status('棋盘已清空，计时重新开始。');
});
for (const b of document.querySelectorAll('.seg-btn')) {
  b.addEventListener('click', () => {
    mode = b.dataset.mode;
    for (const o of document.querySelectorAll('.seg-btn')) o.classList.toggle('is-on', o === b);
    toast(mode === 'paint' ? '涂格' : mode === 'mark' ? '打叉' : '点击循环：空 → 涂 → 叉');
  });
}
$('#btn-next').addEventListener('click', () => startTier(session.tier));
$('#btn-again').addEventListener('click', () => {
  if (!game) return;
  begin({ tier: game.puzzle.tier, puzzle: game.puzzle }).then(() => toast('同一张图，从零开始'));
});
$('#btn-home').addEventListener('click', () => {
  show('menu');
  renderMenu();
});
$('#btn-resume').addEventListener('click', async () => {
  const r = Store.resume();
  if (!r) return;
  const made = generate(r.tier, r.seed);
  if (!made) {
    toast('这张图已经取不到了', 'bad');
    Store.clearResume();
    renderMenu();
    return;
  }
  await begin({
    tier: r.tier,
    puzzle: made.puzzle,
    restore: { board: r.board, elapsedMs: r.elapsedMs, moves: r.moves, hints: r.hints },
  });
});
$('#btn-resume-drop').addEventListener('click', () => {
  Store.clearResume();
  renderMenu();
});
$('#btn-daily').addEventListener('click', () => startDaily());

// ---- 静音开关：HUD 按钮与设置勾选框共用一条路径 -----------------------------------------
// 真静音在 js/audio/synth.js 里做（suspend AudioContext + 静音态不再新建振荡器节点），
// 偏好由 synth 落盘到 localStorage；这里只负责把两个控件的状态对齐到同一份 Store。
function applySound(on) {
  const v = !!on;
  Store.setSetting('sound', v);
  audio.setEnabled(v);
  const box = $('#opt-sound');
  if (box && box.checked !== v) box.checked = v;
  const btn = $('#btn-sound');
  if (btn) {
    btn.setAttribute('aria-pressed', String(v));
    btn.textContent = v ? '♪' : '✕';
    btn.setAttribute('aria-label', v ? '音效开关' : '音效已关');
  }
  return v;
}

window.addEventListener('keydown', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if (ev.target && /^(input|textarea|select)$/i.test(ev.target.tagName || '')) return;
  // M 在本仓未被占用，走房规键位。
  if (ev.key === 'm' || ev.key === 'M') {
    ev.preventDefault();
    applySound(!audio.isEnabled());
    if (audio.isEnabled()) audio.hint();
  }
});

$('#btn-sound').addEventListener('click', () => {
  applySound(!audio.isEnabled());
  if (audio.isEnabled()) audio.hint();
});

$('#opt-sound').addEventListener('change', (e) => {
  applySound(e.target.checked);
});
$('#opt-autocross').addEventListener('change', (e) => Store.setSetting('autoCross', e.target.checked));
$('#opt-errors').addEventListener('change', (e) => Store.setSetting('showErrors', e.target.checked));
$('#opt-motion').addEventListener('change', (e) => {
  Store.setSetting('reduceMotion', e.target.checked);
  setReduceMotion(e.target.checked);
});
$('#btn-help').addEventListener('click', () => ($('#help-sheet').hidden = false));
$('#btn-help-close').addEventListener('click', () => ($('#help-sheet').hidden = true));
$('#btn-reset').addEventListener('click', () => {
  Store.reset();
  renderMenu();
  toast('记录已清空');
});

document.addEventListener('visibilitychange', () => {
  if (!game) return;
  if (document.hidden) {
    game.pause();
    // Synchronous: a backgrounded tab can be discarded at any moment, and a debounced
    // write is a board the player painted but never gets back.
    flushResume();
  } else {
    game.resume();
    lastSecond = -1;
  }
});

window.addEventListener('pagehide', flushResume);

window.addEventListener('resize', () => resize());

// ---------------------------------------------------------------- verifier handle
// Everything the headless harness asserts against runs through here, and every entry
// point is the same function a click calls. There is no test-only second implementation
// of the rules — that is the difference between a passing test and a working game.
window.nonogram = {
  version: '1.0.0',
  bootedAt: Date.now(),
  TIERS,
  tierById,
  dailyTier,
  Store,
  audio,
  EMPTY,
  FILLED,
  CROSS,
  Game,
  BoardView,
  begin,
  startTier,
  startDaily,
  useHint,
  toast,
  engine: { enumerate, analyseLine, deduce, sweep, readLine, isSolved, clueFromSolution },
  gen: { generate, grade, countSolutions },
  dateSeed,
  get game() { return game; },
  get view() { return view; },
  state() {
    if (!game) return null;
    return {
      tier: game.puzzle.tier,
      seed: game.puzzle.seed,
      originSeed: game.puzzle.originSeed,
      name: game.puzzle.name,
      w: game.puzzle.w,
      h: game.puzzle.h,
      score: game.puzzle.score,
      board: Array.from(game.board),
      conflicts: game.view.rowState.map((s, i) => (s.conflict ? 'r' + i : '')).filter(Boolean)
        .concat(game.view.colState.map((s, i) => (s.conflict ? 'c' + i : '')).filter(Boolean)),
      progress: game.progress(),
      moves: game.moves,
      hints: game.hintsUsed,
      closedLines: game.closedLines,
      finished: !!game.finishedAt,
      elapsed: Math.round(game.elapsed()),
    };
  },
  // Drive the rules layer directly: used by the headless play-through scenarios.
  paint(cell, value) {
    if (!game) return false;
    game.paint(cell, value);
    game.endStroke();
    needsDraw = true;
    return true;
  },
  stroke(cells, value) {
    if (!game) return false;
    game.beginStroke();
    for (const c of cells) game.paint(c, value);
    game.endStroke();
    needsDraw = true;
    return true;
  },
  // Paint the whole picture through the same rules path a finger uses.
  solveAll(skip = -1) {
    if (!game) return false;
    game.beginStroke();
    for (let i = 0; i < game.board.length; i++) {
      if (i === skip) continue;
      game.paint(i, game.puzzle.solution[i] ? FILLED : CROSS);
    }
    game.endStroke();
    needsDraw = true;
    return true;
  },
  undo: () => game && game.undo(),
  redo: () => game && game.redo(),
  reset: () => game && game.reset(),
  setMode(m) { mode = m; },
  show,
  screen() {
    return ui.menu.hidden ? (ui.game.hidden ? 'win' : 'game') : 'menu';
  },
  hud() {
    return {
      name: ui.hudName.textContent,
      tier: ui.hudTier.textContent,
      time: ui.hudTime.textContent,
      progress: ui.hudProgress.textContent,
      fillWidth: ui.fill.style.width,
      status: ui.status.textContent,
      undoDisabled: ui.undo.disabled,
      redoDisabled: ui.redo.disabled,
      boardPx: [ui.canvas.width, ui.canvas.height],
    };
  },
};

// ---------------------------------------------------------------- boot
setReduceMotion(Store.setting('reduceMotion'));
renderMenu();
show('menu');
requestAnimationFrame(loop);

// ---- 全屏开关（#btn-fullscreen）----
// 绑的是本页 HUD 上真实存在的那个按钮。全屏最常见的假实现就是引用一个并不存在的
// id：点下去什么也不会发生，量具却算它"已实现"。所以这里找不到按钮就直接不装。
(function bindFullscreen() {
  const btn = document.getElementById('btn-fullscreen');
  if (!btn) return;
  const root = document.documentElement;
  // 只做特性检测，不嗅探 UA：iOS Safari 是 webkitRequestFullscreen，老 Edge 是 ms 前缀，
  // 而 UA 字符串随时会改。"有没有这个能力"是查出来的，不是猜出来的。
  const req = root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen;
  const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
  const current = () => document.fullscreenElement || document.webkitFullscreenElement
    || document.msFullscreenElement || null;

  // 不支持也要给个说法：只把按钮灰掉而不解释，玩家会以为这功能没做完。
  // supported 这枚标记不能省：下面 sync() 每次都会重写 title，不挡住的话，装的时候刚写
  // 进去的人话原因会被随后的 sync() 立刻抹成"全屏 (F)"——禁用就变成一句没有理由的禁用。
  let supported = !!req;
  const unsupported = () => {
    supported = false;
    btn.disabled = true;
    btn.title = '这个浏览器不提供元素全屏（iOS Safari 请用「添加到主屏幕」独立打开）';
  };
  if (!req) unsupported();

  // fullscreen 返回 Promise，被拒时必须吃掉：iOS Safari 对多数非 video 元素直接拒绝，
  // 让这个 rejection 冒泡出去会变成一条未捕获错误，整局游戏跟着挂。
  const settle = (p) => { if (p && p.catch) p.catch(unsupported); };

  // 进出都能走：已经全屏时这次调用是退出，不是"再进一次"。
  function toggle() {
    try {
      if (current()) {
        if (exit) settle(exit.call(document));
      } else if (req) {
        settle(req.call(root));
      } else {
        unsupported();
      }
    } catch (e) {
      unsupported();
    }
  }

  // Esc 和系统手势退出都不经过我们的代码，按钮状态只能靠 fullscreenchange 回写，
  // 否则用户已经退出、HUD 还停在"退出全屏"，下一次点击反而会重新进全屏。
  function sync() {
    const on = !!current();
    btn.setAttribute('aria-pressed', String(on));
    // 图标按钮不换字形（换字形会把 HUD 的视觉语言换掉），改成把可读名与提示写回无障碍属性。
    const say = on ? "退出全屏" : "全屏";
    btn.setAttribute('aria-label', say);
    if (supported) btn.title = say + '（F）';
    const body = document.body;
    if (body && body.classList) body.classList.toggle('fullscreen', on);
  }

  btn.addEventListener('click', toggle);
  window.addEventListener('keydown', (ev) => {
    if (ev.key !== 'f' && ev.key !== 'F') return;
    const t = ev.target;
    // 盘号 / 种子这类输入框里打字不能触发全屏，否则玩家输 seed 输到一半屏幕没了。
    if (t && /input|textarea|select/i.test(t.tagName || '')) return;
    if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    ev.preventDefault();
    toggle();
  });
  window.addEventListener('fullscreenchange', sync);
  window.addEventListener('webkitfullscreenchange', sync);
  window.addEventListener('MSFullscreenChange', sync);
  sync();
})();
