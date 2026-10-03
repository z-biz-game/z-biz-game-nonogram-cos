// Synthesised sound only — a 200 KB sample pack would be the loudest thing in the repo.
// Every cue is short and non-reverbing; the fill tick in particular must survive being
// played forty times a minute without turning abrasive.

let ctx = null;
let master = null;
let enabled = true;

// 静音偏好：读回存档。放在模块顶层，init（首屏、开局、重开）都拿到同一个答案，
// 重开一局不会把玩家的静音选择洗掉。
try {
  if (localStorage.getItem('cos.mute') === '1') enabled = false;
} catch { /* 读不到就沿用默认开声 */ }

function ensure() {
  // 静音态连 ctx 都不许建、不许拉起来：静音期间这个 AudioContext 根本没有在跑。
  if (!enabled) return null;
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.32;
  master.connect(ctx.destination);
  return ctx;
}

export const audio = {
  setEnabled(v) {
    const on = !!v;
    if (on === enabled) return;
    enabled = on;
    // 真静音：停掉 AudioContext 本身（时钟停、图不跑）。
    // 旧写法是 master.gain.value = 0 —— 那是简报点名的假静音：节点照建、时钟照跑，
    // 取消静音后还会有一段没播完的尾巴冒出来。这里不再碰 master.gain。
    if (ctx) {
      if (on) {
        if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
      } else if (ctx.state === 'running' && ctx.suspend) {
        ctx.suspend().catch(() => {});
      }
    }
    // 偏好落盘：刷新页面后 init 要能读回静音态，不能自己弹回来。
    try {
      localStorage.setItem('cos.mute', on ? '1' : '0');
    } catch { /* 隐私模式下写不进去也不该炸游戏 */ }
  },
  isEnabled: () => enabled,
  // Browsers refuse to start audio outside a gesture; the first tap calls this.
  unlock() {
    const c = ensure();
    if (c && c.state === 'suspended') c.resume();
  },

  tone({ freq = 440, dur = 0.08, type = 'sine', gain = 0.5, slide = 0, delay = 0 }) {
    const c = ensure();
    if (!c || !enabled) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  },

  fill() {
    this.tone({ freq: 520, dur: 0.055, type: 'triangle', gain: 0.35, slide: 60 });
  },
  cross() {
    this.tone({ freq: 240, dur: 0.05, type: 'sine', gain: 0.22, slide: -40 });
  },
  erase() {
    this.tone({ freq: 300, dur: 0.04, type: 'sine', gain: 0.16, slide: -90 });
  },
  lineDone() {
    [0, 0.06, 0.12].forEach((d, i) => this.tone({ freq: 660 * Math.pow(1.26, i), dur: 0.09, gain: 0.3, delay: d, type: 'triangle' }));
  },
  hint() {
    this.tone({ freq: 880, dur: 0.12, type: 'sine', gain: 0.26, slide: 220 });
  },
  error() {
    this.tone({ freq: 160, dur: 0.16, type: 'square', gain: 0.16, slide: -60 });
  },
  win() {
    const steps = [523, 659, 784, 1047, 1319];
    steps.forEach((f, i) => this.tone({ freq: f, dur: 0.24, type: 'triangle', gain: 0.3, delay: i * 0.09 }));
  },
};
