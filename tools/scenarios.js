// Browser-side scenarios, injected by tools/playtest.cjs and run against the live page.
// Classic script on purpose: it may only touch window.nonogram, i.e. the same surface a
// click reaches. Anything not reachable that way is not covered here.
//
// Each scenario returns { rows: [{test, pass, detail}], fail, ...extras }.

(function () {
  const rows = [];
  const ok = (test, pass, detail) => rows.push({ test, pass: !!pass, detail: detail === undefined ? '' : String(detail) });
  const done = (extra) => {
    // splice, not `rows.length = 0`: the returned object must be a snapshot. Returning the
    // live array and then clearing it makes every scenario report zero checks while the
    // failure count still says how many broke — a report that looks green and is not.
    const snapshot = rows.splice(0, rows.length);
    const out = { rows: snapshot, fail: snapshot.filter((r) => !r.pass).length };
    Object.assign(out, extra || {});
    return out;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ng = () => window.nonogram;

  // `.hidden === true` proves nothing on its own: a CSS rule with higher specificity
  // (an ID selector, say) still paints the element. Ask the layout which screens
  // actually occupy space.
  const painted = () => ['menu', 'game', 'win']
    .filter((n) => {
      const el = document.querySelector(`[data-screen="${n}"]`);
      return el && el.getClientRects().length > 0;
    })
    .join(',');

  async function waitBooted() {
    for (let i = 0; i < 200; i++) {
      if (window.nonogram && window.nonogram.Game) return true;
      await sleep(50);
    }
    return false;
  }

  async function fresh(tier, seed) {
    const g = await ng().begin({ tier, seed });
    await sleep(60);
    return g;
  }

  // ---------------------------------------------------------------- engine
  async function engine() {
    if (!(await waitBooted())) {
      ok('boot', false, 'window.nonogram never appeared');
      return done();
    }
    const E = ng().engine;
    ok('enumerate(5,[2]) = 4', E.enumerate(5, [2]).length === 4, E.enumerate(5, [2]).join(','));
    ok('enumerate(5,[0]) = 1', E.enumerate(5, [0]).length === 1);
    ok('enumerate(15,[1,1,1,1]) = 495', E.enumerate(15, [1, 1, 1, 1]).length === 495, E.enumerate(15, [1, 1, 1, 1]).length);
    ok('enumerate(5,[6]) = 0', E.enumerate(5, [6]).length === 0);

    const a = E.analyseLine(5, [4], new Uint8Array(5));
    ok('clue [4] forces the middle three', a.forcedFill === 0b01110, a.forcedFill.toString(2));
    const b = E.analyseLine(5, [0], new Uint8Array(5));
    ok('clue [0] crosses everything', b.forcedEmpty === 31, b.forcedEmpty.toString(2));
    const line = new Uint8Array(5);
    line[0] = 1;
    line[2] = 1;
    ok('isolated pokes conflict with [2]', E.analyseLine(5, [2], line).status === 'conflict');

    const g = await fresh('apprentice', 'engine-1');
    const probe = new Uint8Array(g.puzzle.w * g.puzzle.h);
    const res = E.deduce(g.puzzle, probe);
    let left = 0;
    for (let i = 0; i < probe.length; i++) if (probe[i] === 0) left++;
    ok('browser solver completes the board', left === 0, 'undetermined ' + left + ' after ' + res.passes + ' passes');
    ok('deduced board equals the picture', E.isSolved(g.puzzle, probe));
    return done({ tier: g.puzzle.tier, name: g.puzzle.name });
  }

  // ---------------------------------------------------------------- generation
  async function gen() {
    if (!(await waitBooted())) return done();
    const { generate, grade, countSolutions } = ng().gen;
    const TIERS = ng().TIERS;
    const timings = [];
    for (const tier of TIERS) {
      let inBand = 0;
      let unique = 0;
      let logic = 0;
      let sampled = 0;
      const scores = [];
      for (let s = 0; s < 6; s++) {
        const t0 = performance.now();
        const g = generate(tier.id, `web-${s}`);
        timings.push(Math.round(performance.now() - t0));
        if (!g) continue;
        const r = grade(g.puzzle);
        scores.push(Math.round(r.score * 10) / 10);
        if (r.score >= tier.band[0] && r.score < tier.band[1]) inBand++;
        if (r.complete) logic++;
        if (tier.size <= 8) {
          sampled++;
          if (countSolutions(g.puzzle) === 1) unique++;
        }
      }
      ok(`${tier.id}: logic-solvable`, logic === 6, `${logic}/6`);
      ok(`${tier.id}: inside advertised band`, inBand === 6, `${inBand}/6 scores ${scores.join(' ')}`);
      if (sampled) ok(`${tier.id}: unique solution (independent DP)`, unique === sampled, `${unique}/${sampled}`);
    }
    timings.sort((x, y) => x - y);
    return done({ genMsP50: timings[Math.floor(timings.length / 2)], genMsMax: timings[timings.length - 1] });
  }

  // ---------------------------------------------------------------- play
  async function play() {
    if (!(await waitBooted())) return done();
    const N = ng();

    const paintedAtBoot = painted();
    const g = await fresh('apprentice', 'play-1');
    ok('enters the game screen', N.screen() === 'game', N.screen());
    ok('the menu is the only painted screen at boot', paintedAtBoot === 'menu', paintedAtBoot);
    ok('entering a board paints exactly one screen', painted() === 'game', painted());
    ok('HUD names the picture', N.hud().name === g.puzzle.name, N.hud().name);
    ok('board starts blank', g.progress().filled === 0);
    ok('clue count matches the picture', (() => {
      const need = g.puzzle.rows.reduce((a, r) => a + r.reduce((x, y) => x + y, 0), 0);
      let ink = 0;
      for (const v of g.puzzle.solution) ink += v ? 1 : 0;
      return need === ink;
    })());

    // A drag is one undo step.
    const row0 = [];
    for (let x = 0; x < g.puzzle.w; x++) if (g.puzzle.solution[x]) row0.push(x);
    N.stroke(row0.map((x) => x), N.FILLED);
    ok('multi-cell stroke = 1 move', g.moves === 1, g.moves);
    ok('stroke inked the right count', g.progress().filled === row0.length, `${g.progress().filled}/${row0.length}`);
    const beforeUndo = Array.from(g.board);
    N.undo();
    ok('undo restores the whole stroke', g.progress().filled === 0);
    N.redo();
    ok('redo replays it', Array.from(g.board).join('') === beforeUndo.join(''));

    // Auto-cross: closing a clue must mark that line's leftovers, not leave them open.
    N.reset();
    const autoBefore = g.closedLines;
    let y = 0;
    for (; y < g.puzzle.h; y++) {
      const cells = [];
      for (let x = 0; x < g.puzzle.w; x++) if (g.puzzle.solution[y * g.puzzle.w + x]) cells.push(y * g.puzzle.w + x);
      if (!cells.length) continue;
      N.stroke(cells, N.FILLED);
      break;
    }
    let rowUnknowns = 0;
    for (let x = 0; x < g.puzzle.w; x++) if (g.board[y * g.puzzle.w + x] === N.EMPTY) rowUnknowns++;
    ok('closing a clue auto-crosses its line', rowUnknowns === 0, `row ${y} still has ${rowUnknowns}`);
    ok('auto-cross event fired', g.closedLines > autoBefore);
    N.undo();
    ok('undo takes the implied crosses back with the ink', g.progress().determined === 0, g.progress().determined + ' cells still marked');

    // Contradiction reporting — red must mean "cannot fit", and it must not lie.
    N.reset();
    let badRow = -1;
    for (let ry = 0; ry < g.puzzle.h; ry++) {
      const clue = g.puzzle.rows[ry];
      const want = clue.reduce((a, b) => a + b, 0);
      if (want + 1 <= g.puzzle.w) {
        const cells = [];
        for (let x = 0; x <= want; x++) cells.push(ry * g.puzzle.w + x);
        N.stroke(cells, N.FILLED);
        badRow = ry;
        break;
      }
    }
    ok('over-filled row is reported', g.view.rowState[badRow].conflict, 'row ' + badRow);
    ok('conflict is explained in the status line', N.hud().status.includes('打架'), N.hud().status);
    // The red digits on the gutters and the lines named in the status come from the same
    // state; if one channel drops a line the player is told to look somewhere else.
    const redLines = g.view.rowState.filter((s) => s.conflict).length + g.view.colState.filter((s) => s.conflict).length;
    const namedLines = (N.hud().status.match(/第 \d+ [行列]/g) || []).length;
    ok('every red line is named in the status', namedLines === redLines && redLines > 0, `${namedLines} named vs ${redLines} flagged`);
    let marked = 0;
    for (let i = 0; i < g.board.length; i++) if (g.conflictCells[i]) marked++;
    ok('conflict marks the offending block only', marked > 0 && marked <= want0(g, badRow) + 1, `${marked} cells`);
    N.reset();
    ok('reset clears ink and history', g.progress().filled === 0 && g.moves === 0);

    // Full playthrough to a win, through the real rules path.
    N.solveAll();
    for (let i = 0; i < 80 && N.screen() !== 'win'; i++) await sleep(50);
    ok('finishing the picture wins', !!g.finishedAt && N.screen() === 'win', N.screen());
    ok('the win screen replaces the board', painted() === 'win', painted());
    ok('win card shows the name', document.getElementById('win-name').textContent === g.puzzle.name);
    ok('win card reports measured passes', /\d/.test(document.getElementById('win-passes').textContent));
    // The stroke that completes the board must already be counted when the win is recorded,
    // or every finished board reports one move too few.
    ok('win card counts the finishing move', document.getElementById('win-moves').textContent === String(g.moves), `${document.getElementById('win-moves').textContent} vs ${g.moves}`);
    ok('progress reached 100%', N.hud().progress.includes('100'), N.hud().progress);

    // Wrong-but-locally-consistent ink must not be called a win.
    const g2 = await fresh('apprentice', 'play-2');
    const fake = new Uint8Array(g2.puzzle.w * g2.puzzle.h);
    // fill entire board: guaranteed to break at least one clue unless the picture is solid
    for (let i = 0; i < fake.length; i++) fake[i] = 1;
    let allSolidConflicts = false;
    if (g2.puzzle.solution.some((v) => !v)) {
      N.stroke(Array.from({ length: fake.length }, (_, i) => i), N.FILLED);
      allSolidConflicts = g2.conflicted;
      ok('all-ink board is rejected as a win', !g2.finishedAt && allSolidConflicts);
    }
    return done({ closedLines: g.closedLines });
  }

  function want0(g, row) {
    return g.puzzle.rows[row].reduce((a, b) => a + b, 0);
  }

  // ---------------------------------------------------------------- hints
  async function hint() {
    if (!(await waitBooted())) return done();
    const N = ng();
    let solvedAlone = 0;
    let checked = 0;
    for (const seed of ['hint-0', 'hint-1', 'hint-2']) {
      for (const tier of ['apprentice', 'journey', 'adept']) {
        const g = await fresh(tier, seed);
        N.useHint();
        await sleep(20);
        // Every hint must be both correct and explainable.
        let guard = 0;
        let bad = 0;
        let unexplained = 0;
        while (guard++ < 700) {
          const before = g.progress().determined;
          const h = g.hint();
          if (!h || !h.cells || !h.cells.length) break;
          if (!/线索|核对/.test(h.text)) unexplained++;
          for (const c of h.cells) {
            const want = g.puzzle.solution[c] ? N.FILLED : N.CROSS;
            if (g.board[c] !== want && g.board[c] !== N.EMPTY) bad++;
          }
          if (g.progress().determined === before) break;
        }
        checked++;
        ok(`${tier}/${seed}: hints never lie`, bad === 0, `${bad} wrong cells`);
        ok(`${tier}/${seed}: every hint names a rule`, unexplained === 0, unexplained);
        const done = g.progress().determined;
        ok(`${tier}/${seed}: hints alone finish the board`, done === g.board.length, `${done}/${g.board.length}`);
        if (done === g.board.length) solvedAlone++;
      }
    }
    return done({ boardsClearedByHints: solvedAlone, boards: checked });
  }

  // ---------------------------------------------------------------- save / resume
  async function save() {
    if (!(await waitBooted())) return done();
    const N = ng();
    // Clear through the real button: it also re-renders the menu, which is the only way to
    // see "nothing to continue" the way a player does.
    document.getElementById('btn-reset').click();
    const card = document.getElementById('resume-card');
    ok('no save means no continue card', card.getClientRects().length === 0, 'the card is painted with nothing to resume');
    const g = await fresh('apprentice', 'save-1');
    const cells = [];
    for (let i = 0; i < g.puzzle.solution.length && cells.length < 4; i++) if (g.puzzle.solution[i]) cells.push(i);
    N.stroke(cells, N.FILLED);
    // Leaving the page must not cost the player the board they painted, so the flush here
    // is synchronous — no sleep, because a test that waits for a debounce only proves the
    // debounce is short.
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    const raw = localStorage.getItem('nonogram.save.v1');
    ok('storage written', !!raw);
    const parsed = JSON.parse(raw || '{}');
    ok('one stroke is enough to be worth saving', !!parsed.resume, 'resume null after a committed move');
    ok('resume keeps the origin seed', parsed.resume && parsed.resume.seed === g.puzzle.originSeed, parsed.resume && parsed.resume.seed);
    ok('resume ink decodes to the board length', parsed.resume && parsed.resume.cells === g.board.length, parsed.resume && parsed.resume.cells);
    ok('resume carries what the run cost', !!parsed.resume && parsed.resume.moves === g.moves && parsed.resume.hints === g.hintsUsed,
      `${parsed.resume && parsed.resume.moves} moves / ${parsed.resume && parsed.resume.hints} hints vs ${g.moves}/${g.hintsUsed}`);
    const decoded = parsed.resume ? Array.from(N.Store.resume().board).join('') : '';
    ok('resume ink is the board it saved', decoded === Array.from(g.board).join(''), decoded.length + ' cells');

    // Back to the menu the way a player does it, then check the offer is real and named.
    document.getElementById('btn-home').click();
    await sleep(80);
    ok('a saved board offers the continue card', card.getClientRects().length > 0, 'card painted nothing after a save');
    ok('the card names the saved picture', document.getElementById('resume-name').textContent.includes(g.puzzle.name), document.getElementById('resume-name').textContent);

    // Best-time rule: fewer hints wins, then fewer moves, then faster.
    N.Store.data.best = {};
    N.Store.recordBest('apprentice', { ms: 5000, hints: 1, moves: 9, size: 5 });
    const b1 = N.Store.recordBest('apprentice', { ms: 1000, hints: 2, moves: 30, size: 5 });
    ok('a faster run with more hints is not a record', b1 === false);
    const b2 = N.Store.recordBest('apprentice', { ms: 4000, hints: 0, moves: 12, size: 5 });
    ok('a hint-free run is a record', b2 === true);
    ok('record kept the hint-free run', N.Store.best('apprentice').hints === 0);

    // Daily streak counts days, not solves.
    N.Store.data.daily = { lastKey: null, streak: 0, solved: [] };
    const y = new Date(Date.now() - 86400000);
    const yKey = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
    N.Store.markDaily(yKey);
    const today = N.dateSeed().key;
    const r1 = N.Store.markDaily(today);
    const r2 = N.Store.markDaily(today);
    ok('consecutive day extends the streak', r1.streak === 2, r1.streak);
    ok('same day twice does not', r2.streak === 2 && r2.isNew === false, r2.streak);
    return done({ storedBytes: (raw || '').length });
  }

  async function resume() {
    if (!(await waitBooted())) return done();
    const N = ng();
    const r = N.Store.resume();
    ok('a saved board survived the reload', !!r, r && r.name);
    if (!r) return done();
    const card = document.getElementById('resume-card');
    ok('menu offers the continue card', card.getClientRects().length > 0, 'not painted');
    document.getElementById('btn-resume').click();
    // The screen flips before the board exists: begin() prints "正在出题…" and builds the
    // game on a later frame, so polling the screen alone reads a half-open state.
    for (let i = 0; i < 80 && !N.game; i++) await sleep(50);
    const g = N.game;
    ok('resumed into the game', !!g && N.screen() === 'game', `screen=${N.screen()} status=${N.hud().status}`);
    if (!g) return done();
    ok('resumed the same picture', g.puzzle.originSeed === r.seed, g.puzzle.originSeed);
    const same = Array.from(g.board).join('') === Array.from(r.board).join('');
    ok('resumed ink matches', same);
    ok('resumed clock continues, not restarts', g.elapsed() >= r.elapsedMs - 200, `${g.elapsed()} vs ${r.elapsedMs}`);
    // A record is only honest if the cost of the run follows the board across the reload:
    // 提示 decides the best time, and a resume that reset it could be farmed.
    ok('resumed run keeps its move count', g.moves === r.moves, `${g.moves} vs ${r.moves}`);
    ok('resumed run keeps its hint count', g.hintsUsed === r.hints, `${g.hintsUsed} vs ${r.hints}`);
    const hintsBefore = g.hintsUsed;
    N.useHint();
    await sleep(20);
    ok('the resumed run keeps paying for its help', g.hintsUsed === hintsBefore + 1, `${hintsBefore} → ${g.hintsUsed}`);
    N.solveAll();
    for (let i = 0; i < 80 && N.screen() !== 'win'; i++) await sleep(50);
    ok('finishing clears the resume record', !N.Store.resume());
    return done({ name: g && g.puzzle.name });
  }

  // ---------------------------------------------------------------- layout / input
  async function layout() {
    if (!(await waitBooted())) return done();
    const N = ng();
    const g = await fresh('master', 'layout-1');
    const view = N.view;
    const geo = view.geo;
    ok('cell size inside the token band', geo.cell >= 17 && geo.cell <= 46, geo.cell);
    ok('board fits its container', geo.w <= document.getElementById('board-wrap').clientWidth + 1, `${geo.w} vs ${document.getElementById('board-wrap').clientWidth}`);
    ok('clue gutter sits left of the board', geo.originX > geo.boardW * 0.05, geo.originX);

    // Every cell must map back to itself through the canvas transform — the one test
    // that catches an off-by-one between layout and hit testing.
    let mismatch = 0;
    let outside = 0;
    for (let i = 0; i < g.board.length; i++) {
      const x = i % g.puzzle.w;
      const y = (i / g.puzzle.w) | 0;
      const hit = view.hitTest(geo.originX + x * geo.cell + geo.cell / 2, geo.originY + y * geo.cell + geo.cell / 2);
      if (!hit || hit.cell !== i) mismatch++;
    }
    ok('hitTest round-trips every cell', mismatch === 0, mismatch + ' mismatches');
    for (const [px, py] of [[0, 0], [-10, 40], [geo.w + 5, geo.h + 5], [geo.originX - 9999, geo.originY + 1]]) {
      const hit = view.hitTest(px, py);
      if (hit && hit.cell !== undefined) outside++;
    }
    ok('misses outside the board report no cell', outside === 0);

    const clueHits = [
      view.hitTest(geo.originX - geo.cell / 2, geo.originY + geo.cell * 1.5),
      view.hitTest(geo.originX + geo.cell * 2.5, geo.originY - geo.cell / 2),
    ];
    ok('tapping the left gutter focuses a row', clueHits[0] && clueHits[0].horizontal === true && clueHits[0].index === 1, JSON.stringify(clueHits[0]));
    ok('tapping the top gutter focuses a column', clueHits[1] && clueHits[1].horizontal === false && clueHits[1].index === 2, JSON.stringify(clueHits[1]));

    // Canvas backing store must follow devicePixelRatio or the grid renders blurry.
    const dpr = window.devicePixelRatio || 1;
    ok('backing store matches DPR', Math.abs(view.canvas.width - Math.round(geo.w * dpr)) <= 1, `${view.canvas.width} / ${geo.w}@${dpr}`);

    // Real pointer input through the canvas, not just the rules layer.
    const rect = view.canvas.getBoundingClientRect();
    const cx = rect.left + geo.originX + 0 * geo.cell + geo.cell / 2;
    const cy = rect.top + geo.originY + 0 * geo.cell + geo.cell / 2;
    const before = Array.from(g.board).join('');
    const fire = (type, x, y, extra) => view.canvas.dispatchEvent(new PointerEvent(type, Object.assign({
      bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, buttons: 1, button: 0,
    }, extra || {})));
    view.canvas.setPointerCapture = () => {};
    view.canvas.releasePointerCapture = () => {};
    N.setMode('paint');
    fire('pointerdown', cx, cy);
    fire('pointermove', rect.left + geo.originX + geo.cell * 1.5, cy);
    fire('pointerup', rect.left + geo.originX + geo.cell * 1.5, cy);
    const inked = g.board.filter((v) => v === N.FILLED).length;
    ok('drag paints more than one cell', inked >= 2, inked);
    ok('drag was one stroke', g.moves === 1, g.moves);
    N.setMode('mark');
    fire('pointerdown', rect.left + geo.originX + geo.cell * (g.puzzle.w - 0.5), rect.top + geo.originY + geo.cell * (g.puzzle.h - 0.5));
    fire('pointerup', rect.left + geo.originX + geo.cell * (g.puzzle.w - 0.5), rect.top + geo.originY + geo.cell * (g.puzzle.h - 0.5));
    ok('mark mode crosses instead of fills', g.board[g.board.length - 1] === N.CROSS, g.board[g.board.length - 1]);
    void before;
    return done({ cell: geo.cell, dpr });
  }

  window.__ng = { engine, gen, play, hint, save, resume, layout };
})();
