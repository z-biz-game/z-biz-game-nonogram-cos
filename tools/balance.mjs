// Difficulty measurement rig — `node tools/balance.mjs [seedsPerTier]`.
//
// The tier bands in generate.js are read off this table. Changing the score formula or
// the art grammar without re-running this is how a game ends up advertising "大师" for
// a board a beginner can finish in one sweep.

import { generate, grade, countSolutions, TIERS } from '../js/engine/generate.js';

const N = Number(process.argv[2] || 40);

const fmt = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return {
    n: s.length,
    min: s[0],
    p25: q(0.25),
    med: q(0.5),
    p75: q(0.75),
    max: s[s.length - 1],
  };
};

console.log(`tier         n  score min/p25/med/p75/max            passes      stuck0  search   unique-checked`);
let worst = { over: 0, under: 0 };
for (const tier of TIERS) {
  const scores = [];
  const passes = [];
  const stuck = [];
  const search = [];
  let missing = 0;
  let uniqueOk = 0;
  let uniqueSampled = 0;
  for (let s = 0; s < N; s++) {
    const g = generate(tier.id, `bal-${s}`);
    if (!g) { missing++; continue; }
    const r = grade(g.puzzle);
    scores.push(r.score);
    passes.push(r.passes);
    stuck.push(r.stuck0);
    search.push(g.puzzle.attempts);
    if (tier.size <= 10 && s < 8) {
      uniqueSampled++;
      if (countSolutions(g.puzzle) === 1) uniqueOk++;
    }
  }
  const a = fmt(scores);
  const b = fmt(passes);
  const c = fmt(stuck);
  const d = fmt(search);
  const bandHit = scores.filter((v) => v >= tier.band[0] && v < tier.band[1]).length;
  if (bandHit < scores.length) worst.over += scores.length - bandHit;
  console.log(
    `${tier.label.padEnd(4)} ${String(tier.size) + '×' + tier.size} `.padEnd(12) +
      `${String(scores.length).padStart(2)}  ` +
      `${a.min.toFixed(1)}/${a.p25.toFixed(1)}/${a.med.toFixed(1)}/${a.p75.toFixed(1)}/${a.max.toFixed(1)}`.padEnd(28) +
      `${b.min}/${b.med}/${b.max}`.padStart(12) +
      `${c.min.toFixed(2)}/${c.med.toFixed(2)}/${c.max.toFixed(2)}`.padStart(15) +
      `${d.min}/${d.med}/${d.max}`.padStart(10) +
      `  ${uniqueOk}/${uniqueSampled}` +
      `  band-hit ${bandHit}/${scores.length}${missing ? ` MISSING ${missing}` : ''}`
  );
}
console.log(`\nband assignment: ${TIERS.map((t) => `${t.id} [${t.band[0]}, ${t.band[1]})`).join('  ')}`);
console.log(worst.over ? `\n${worst.over} puzzle(s) fell outside their advertised band` : '\nall sampled puzzles inside their advertised band');
