// Difficulty measurement rig — `node tools/balance.mjs [seedsPerTier]`.
//
// The tier bands in generate.js are read off this table. Changing the score formula or
// the art grammar without re-running this is how a game ends up advertising "大师" for
// a board a beginner can finish in one sweep.
//
// The exit code IS the verdict: this rig used to print "N puzzle(s) fell outside their
// advertised band" and still leave 0 behind, so the sentence could never make CI red.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, grade, countSolutions, TIERS } from '../js/engine/generate.js';

// README 的五档表自称「`npm run balance` 每档 40 局的实测分数区间」：那张表是本台架的输出，
// 只有跑满 40 局才对得上，缩样时不校验也别说校验过。
const SEEDS_PER_TIER = 40;
const N = Number(process.argv[2] || SEEDS_PER_TIER);

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
const measured = [];
let missingTotal = 0;
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
  missingTotal += missing;
  // 全档空生成时 fmt([]) 会在 toFixed 上炸掉，红线反而变成一句 TypeError：先记下这一档，
  // 让它以「什么都没生成」的名义红。
  if (scores.length === 0) {
    console.log(`${tier.label.padEnd(4)} ${String(tier.size) + '×' + tier.size} `.padEnd(12) +
      ` 0  (no puzzle generated)${missing ? ` MISSING ${missing}` : ''}`);
    continue;
  }
  const a = fmt(scores);
  const b = fmt(passes);
  const c = fmt(stuck);
  const d = fmt(search);
  const bandHit = scores.filter((v) => v >= tier.band[0] && v < tier.band[1]).length;
  if (bandHit < scores.length) worst.over += scores.length - bandHit;
  measured.push({ label: tier.label, min: a.min, max: a.max });
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

// README 把五档表挂在 `npm run balance` 名下，那它就是这个台架的一块输出：改了打分公式、
// 形状文法或 band 却没重跑回贴，界面就在替一个不再存在的分布说话。引擎与 README 都是仓内
// 文本、种子写死，所以这里钉等值而不是钉范围。
function readmeMismatch() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const doc = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const rows = [...doc.matchAll(
    /^\|\s*([^|]+?)\s*\|\s*\d+×\d+\s*\|\s*([0-9.]+)\s*[–-]\s*([0-9.]+)\s*\|/gm,
  )];
  if (rows.length === 0) return 'README 里抓不到「实测难度分」那列 —— 判据自己空了，不是文档过关';
  const byLabel = new Map(rows.map((m) => [m[1].trim(), [Number(m[2]), Number(m[3])]]));
  const bad = [];
  for (const t of measured) {
    const d = byLabel.get(t.label);
    if (!d) { bad.push(`${t.label} 在 README 表里没有行`); continue; }
    const want = [Number(t.min.toFixed(1)), Number(t.max.toFixed(1))];
    if (d[0] !== want[0] || d[1] !== want[1]) bad.push(`${t.label} README 写 ${d[0]}–${d[1]}，实测 ${want[0]}–${want[1]}`);
  }
  for (const label of byLabel.keys()) {
    if (!measured.some((t) => t.label === label)) bad.push(`README 表里的 ${label} 已经不是 TIERS 的一档`);
  }
  return bad.length ? `README 的「实测难度分」表与本台架对不上：${bad.join('；')}` : '';
}

const fails = [];
if (worst.over) fails.push(`${worst.over} puzzle(s) fell outside their advertised band`);
if (missingTotal) fails.push(`${missingTotal} 个种子一个都没生成出盘（generate 返回 null）`);
if (measured.length !== TIERS.length) fails.push(`${TIERS.length - measured.length} 档什么都没测到`);
if (N !== SEEDS_PER_TIER) {
  console.log(`\nNOTE 文档校验本次跳过：README 表钉的是每档 ${SEEDS_PER_TIER} 局，这一跑 N=${N}`);
} else {
  const mismatch = readmeMismatch();
  if (mismatch) fails.push(mismatch);
}
fails.forEach((f) => console.log(`FAIL ${f}`));
if (!fails.length) console.log('\nall sampled puzzles inside their advertised band，README 表与实测一致');
process.exit(fails.length ? 1 : 0);
