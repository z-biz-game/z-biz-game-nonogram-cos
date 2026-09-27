// Canvas board. Geometry is derived from the container on every resize (never a fixed
// pixel count) so a 15×15 on a phone and on a desktop are the same game, and every
// colour comes from theme.js.

import { Palette as P, Space, Radius, Motion, Font, Cell, prefersReducedMotion } from '../theme.js';
import { EMPTY, FILLED, CROSS } from '../engine/line.js';

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export class BoardView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.geo = null;
    this.pulses = new Map();
    this.flashes = new Map();
    this.winAt = 0;
    this.w = 0;
    this.h = 0;
  }

  static maxClueLen(clues) {
    let m = 0;
    for (const c of clues) m = Math.max(m, c.length);
    return Math.max(1, m);
  }

  layout(puzzle, availW, availH) {
    const leftRuns = BoardView.maxClueLen(puzzle.rows);
    const topRuns = BoardView.maxClueLen(puzzle.cols);
    const k = Cell.clueScale;
    const byWidth = (availW - Space.inner * 2) / (puzzle.w + leftRuns * k);
    const byHeight = (availH - Space.inner * 2) / (puzzle.h + topRuns * k);
    const cell = Math.max(Cell.min, Math.min(Cell.max, Math.floor(Math.min(byWidth, byHeight))));
    const cluePad = cell * k;

    this.w = puzzle.w;
    this.h = puzzle.h;
    this.geo = {
      cell,
      cluePad,
      leftRuns,
      topRuns,
      originX: Math.round(Space.inner + leftRuns * cluePad),
      originY: Math.round(Space.inner + topRuns * cluePad),
      boardW: cell * puzzle.w,
      boardH: cell * puzzle.h,
      w: Math.round(leftRuns * cluePad + cell * puzzle.w + Space.inner * 2),
      h: Math.round(topRuns * cluePad + cell * puzzle.h + Space.inner * 2),
    };
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    const g = this.geo;
    this.canvas.style.width = g.w + 'px';
    this.canvas.style.height = g.h + 'px';
    this.canvas.width = Math.round(g.w * dpr);
    this.canvas.height = Math.round(g.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return g;
  }

  // Board cells, then the two clue gutters (tapping a clue focuses that line).
  hitTest(px, py) {
    const g = this.geo;
    if (!g) return null;
    const inBoardX = px >= g.originX && px < g.originX + g.boardW;
    const inBoardY = py >= g.originY && py < g.originY + g.boardH;
    if (inBoardX && inBoardY) {
      const x = Math.floor((px - g.originX) / g.cell);
      const y = Math.floor((py - g.originY) / g.cell);
      return { cell: y * this.w + x, x, y };
    }
    if (
      !inBoardX &&
      inBoardY &&
      px >= g.originX - g.leftRuns * g.cluePad &&
      py >= g.originY - g.topRuns * g.cluePad
    ) {
      return { clue: true, horizontal: true, index: Math.floor((py - g.originY) / g.cell) };
    }
    if (
      inBoardX &&
      !inBoardY &&
      py >= g.originY - g.topRuns * g.cluePad &&
      px >= g.originX - g.leftRuns * g.cluePad
    ) {
      return { clue: true, horizontal: false, index: Math.floor((px - g.originX) / g.cell) };
    }
    return null;
  }

  pulse(cell, kind, now) {
    if (!prefersReducedMotion()) this.pulses.set(cell, { kind, at: now });
  }

  lineComplete(horizontal, index, now) {
    if (!prefersReducedMotion()) this.flashes.set((horizontal ? 'r' : 'c') + index, { at: now });
  }

  beginWin(now) {
    this.winAt = now;
  }

  animating(now) {
    if (this.winAt) return true;
    for (const v of this.pulses.values()) if (now - v.at < Motion.pop) return true;
    for (const v of this.flashes.values()) if (now - v.at < Motion.line) return true;
    return false;
  }

  render(game, now) {
    const { puzzle, board, view } = game;
    const g = this.geo;
    if (!g) return;
    this.w = puzzle.w;
    this.h = puzzle.h;
    const ctx = this.ctx;
    const c = g.cell;
    const reduced = prefersReducedMotion();

    ctx.clearRect(0, 0, g.w, g.h);

    if (view.focus) {
      ctx.fillStyle = P.focus;
      if (view.focus.horizontal) ctx.fillRect(g.originX, g.originY + view.focus.index * c, g.boardW, c);
      else ctx.fillRect(g.originX + view.focus.index * c, g.originY, c, g.boardH);
    }

    // ---- clue gutters: last number sits against the board, earlier ones walk away ----
    const clueFont = Math.max(9, Math.round(c * 0.6));
    ctx.font = `600 ${clueFont}px ${Font.mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const drawClue = (numbers, st, ax, ay, vertical) => {
      const n = numbers.length;
      for (let i = 0; i < n; i++) {
        const fromEnd = n - 1 - i;
        const dim = fromEnd < st.matched;
        ctx.fillStyle = st.conflict ? P.error : dim ? P.inkFaint : P.inkDim;
        const px = vertical ? ax : ax - fromEnd * c;
        const py = vertical ? ay - fromEnd * c : ay;
        ctx.fillText(String(numbers[i]), px, py);
        if (dim) {
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(px - clueFont * 0.33, py);
          ctx.lineTo(px + clueFont * 0.33, py);
          ctx.stroke();
        }
      }
    };
    for (let y = 0; y < puzzle.h; y++) {
      drawClue(puzzle.rows[y], view.rowState[y], g.originX - c * 0.5, g.originY + y * c + c * 0.5, false);
    }
    for (let x = 0; x < puzzle.w; x++) {
      drawClue(puzzle.cols[x], view.colState[x], g.originX + x * c + c * 0.5, g.originY - c * 0.5, true);
    }

    // ---- cells ------------------------------------------------------------
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.originX, g.originY, g.boardW, g.boardH);
    ctx.clip();
    ctx.fillStyle = P.surface;
    ctx.fillRect(g.originX, g.originY, g.boardW, g.boardH);

    for (let i = 0; i < board.length; i++) {
      const v = board[i];
      if (v === EMPTY) continue;
      const x = i % puzzle.w;
      const y = (i / puzzle.w) | 0;
      const px = g.originX + x * c;
      const py = g.originY + y * c;
      let scale = 1;
      const pulse = this.pulses.get(i);
      if (pulse) {
        const t = (now - pulse.at) / Motion.pop;
        if (t >= 1 || reduced) this.pulses.delete(i);
        else scale = 1 + 0.18 * Math.sin(Math.PI * t) * (pulse.kind === 'fill' ? 1 : 0.5);
      }
      if (v === FILLED) {
        const pad = (c - c * scale) / 2 + 1;
        ctx.fillStyle = game.conflictCells[i] ? P.error : P.filled;
        roundRect(ctx, px + pad, py + pad, c - pad * 2, c - pad * 2, Math.min(Radius.cell, c * 0.2));
        ctx.fill();
        if (!reduced && c >= 22) {
          ctx.fillStyle = 'rgba(255,255,255,0.2)';
          roundRect(ctx, px + pad, py + pad, c - pad * 2, Math.max(1.5, (c - pad * 2) * 0.22), Radius.cell);
          ctx.fill();
        }
      } else {
        const m = Math.max(3, c * 0.2);
        const ox = px + (c - m) / 2;
        const oy = py + (c - m) / 2;
        ctx.strokeStyle = P.crossed;
        ctx.lineWidth = Math.max(1.4, c * 0.09);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ox + m, oy + m);
        ctx.moveTo(ox + m, oy);
        ctx.lineTo(ox, oy + m);
        ctx.stroke();
      }
    }

    if (view.hints.size) {
      const t = reduced ? 0.5 : (Math.sin(now / 260) + 1) / 2;
      ctx.strokeStyle = P.hint;
      ctx.globalAlpha = 0.35 + t * 0.5;
      ctx.lineWidth = 2;
      for (const i of view.hints) {
        const x = i % puzzle.w;
        const y = (i / puzzle.w) | 0;
        ctx.strokeRect(g.originX + x * c + 1.5, g.originY + y * c + 1.5, c - 3, c - 3);
      }
      ctx.globalAlpha = 1;
    }

    // keyboard marker
    if (view.cursor) {
      ctx.strokeStyle = P.info;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(g.originX + view.cursor.x * c + 1, g.originY + view.cursor.y * c + 1, c - 2, c - 2);
      ctx.setLineDash([]);
    }

    for (const [key, { at }] of this.flashes) {
      const t = (now - at) / Motion.line;
      if (t >= 1) {
        this.flashes.delete(key);
        continue;
      }
      const horiz = key[0] === 'r';
      const index = Number(key.slice(1));
      ctx.fillStyle = `rgba(40,167,69,${0.3 * (1 - t)})`;
      if (horiz) ctx.fillRect(g.originX, g.originY + index * c, g.boardW, c);
      else ctx.fillRect(g.originX + index * c, g.originY, c, g.boardH);
    }

    // grid on top of ink
    ctx.strokeStyle = P.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= puzzle.w; x++) {
      const px = Math.round(g.originX + x * c) + 0.5;
      ctx.moveTo(px, g.originY);
      ctx.lineTo(px, g.originY + g.boardH);
    }
    for (let y = 0; y <= puzzle.h; y++) {
      const py = Math.round(g.originY + y * c) + 0.5;
      ctx.moveTo(g.originX, py);
      ctx.lineTo(g.originX + g.boardW, py);
    }
    ctx.stroke();
    ctx.strokeStyle = P.lineHeavy;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 5; x < puzzle.w; x += 5) {
      const px = Math.round(g.originX + x * c);
      ctx.moveTo(px, g.originY);
      ctx.lineTo(px, g.originY + g.boardH);
    }
    for (let y = 5; y < puzzle.h; y += 5) {
      const py = Math.round(g.originY + y * c);
      ctx.moveTo(g.originX, py);
      ctx.lineTo(g.originX + g.boardW, py);
    }
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = P.lineHeavy;
    ctx.lineWidth = 2;
    ctx.strokeRect(g.originX - 1, g.originY - 1, g.boardW + 2, g.boardH + 2);

    // win: a light front crosses the finished picture once
    if (this.winAt) {
      const total = Motion.win + puzzle.w * 30;
      const t = (now - this.winAt) / total;
      if (t >= 1 || reduced) this.winAt = 0;
      else {
        const head = t * (g.boardW + g.boardH) * 1.35;
        ctx.save();
        ctx.beginPath();
        ctx.rect(g.originX, g.originY, g.boardW, g.boardH);
        ctx.clip();
        ctx.globalCompositeOperation = 'lighter';
        for (let y = 0; y < puzzle.h; y++)
          for (let x = 0; x < puzzle.w; x++) {
            if (!puzzle.solution[y * puzzle.w + x]) continue;
            const k = 1 - Math.min(1, Math.abs(x * c + y * c - head) / (c * 2.4));
            if (k <= 0) continue;
            ctx.fillStyle = `rgba(255,217,138,${0.5 * k})`;
            ctx.fillRect(g.originX + x * c, g.originY + y * c, c, c);
          }
        ctx.restore();
      }
    }
  }
}
