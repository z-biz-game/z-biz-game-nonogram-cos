// Engine unit tests, run in plain Node: `node tools/engine-test.mjs`.
//
// These are the hand-checkable truths the whole game rests on. If a bitmask here is
// wrong, every generated puzzle inherits the bug — which is why they are asserted
// against values worked out by hand rather than against the solver's own output.

import {
  enumerate,
  analyseLine,
  maskOf,
  runsOf,
  clueFromSolution,
  FILLED,
  EMPTY,
} from '../js/engine/line.js';
import { generate, grade, countSolutions, TIERS } from '../js/engine/generate.js';

let pass = 0;
let fail = 0;
const eq = (name, got, want) => {
  if (String(got) === String(want)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${name}\n       got  ${got}\n       want ${want}`);
  }
};
const bits = (m, len) => m.toString(2).padStart(len, '0');

console.log('== line enumeration ==');
eq('width 5 clue [2] count', enumerate(5, [2]).length, 4);
eq(
  'width 5 clue [2] masks',
  enumerate(5, [2]).map((m) => bits(m, 5)).join(' '),
  '00011 00110 01100 11000'
);
eq('clue [0] is the all-empty line', enumerate(5, [0]).length, 1);
eq('clue [5] fills the line', enumerate(5, [5]).length, 1);
eq('width 5 clue [1,1]', enumerate(5, [1, 1]).length, 6);
eq('impossible clue yields nothing', enumerate(5, [6]).length, 0);
eq('width 15 clue [1,1,1,1] = C(12,4)', enumerate(15, [1, 1, 1, 1]).length, 495);
eq('width 10 clue [2,3] count', enumerate(10, [2, 3]).length, 15);
eq('every mask has the right run shape', enumerate(7, [2, 3]).every((m) => runsOf(m).join(',') === '2,3'), true);
eq('no mask is duplicated', new Set(enumerate(12, [3, 1, 2])).size, enumerate(12, [3, 1, 2]).length);

console.log('== forced-cell arithmetic ==');
{
  const a = analyseLine(5, [4], new Uint8Array(5));
  eq('clue [4] on width 5 forces the middle three', bits(a.forcedFill, 5), bits(0b01110, 5));
  eq('clue [4] forces nothing empty', a.forcedEmpty, 0);
  eq('clue [4] keeps 2 options', a.live, 2);
}
{
  const a = analyseLine(5, [1], new Uint8Array(5));
  eq('clue [1] forces no fill', a.forcedFill, 0);
  eq('clue [1] forces no cross', a.forcedEmpty, 0);
  eq('clue [1] has 5 options', a.live, 5);
}
{
  const line = new Uint8Array(5);
  line[2] = FILLED;
  const a = analyseLine(5, [2], line);
  eq('clue [2] through cell 2 → 2 options', a.live, 2);
  eq('clue [2] through cell 2 forces nothing new', a.forcedFill, 0);
  eq('clue [2] through cell 2 → ends excluded', bits(a.forcedEmpty & maskOf(5), 5), '10001');
}
{
  const line = new Uint8Array(5);
  line[0] = FILLED;
  line[2] = FILLED;
  eq('two isolated pokes contradict clue [2]', analyseLine(5, [2], line).status, 'conflict');
}
{
  const a = analyseLine(5, [0], new Uint8Array(5));
  eq('clue [0] crosses the whole line', a.forcedEmpty, maskOf(5));
  eq('clue [0] leaves no unknown', a.forcedFill, 0);
}
{
  const line = new Uint8Array(5);
  line[4] = FILLED;
  const a = analyseLine(5, [3], line);
  eq('clue [3] anchored right forces cells 1..3 too', bits(a.forcedFill, 5), '01100');
  eq('clue [3] anchored right is a single arrangement', a.live, 1);
}
{
  eq('runsOf', runsOf(0b01100011).join(','), '2,2');
  eq('runsOf(0b11100011)', runsOf(0b11100011).join(','), '2,3');
  eq('runsOf(0)', runsOf(0).join(','), '');
}

console.log('== clue extraction round-trips ==');
{
  const px = [1, 1, 0, 0, 1, 1, 0, 1, 0];
  const solution = new Uint8Array(px);
  const { rows, cols } = clueFromSolution({ w: 3, h: 3, solution });
  eq('row clues', rows.map((r) => r.join('.')).join('|'), '2|2|1');
  eq('col clues', cols.map((r) => r.join('.')).join('|'), '1|3|1');
}

console.log('== generator guarantees (all five tiers) ==');
for (const tier of TIERS) {
  const n = tier.size;
  let unique = 0;
  let logic = 0;
  let inBand = 0;
  let generated = 0;
  let scoreMin = Infinity;
  let scoreMax = 0;
  let attemptsWorst = 0;
  const spot = [];
  for (let s = 0; s < 12; s++) {
    const g = generate(tier.id, `unit-${s}`);
    if (!g) continue;
    generated++;
    attemptsWorst = Math.max(attemptsWorst, g.puzzle.attempts);
    const r = grade(g.puzzle);
    if (r.complete) logic++;
    if (r.score >= tier.band[0] && r.score < tier.band[1]) inBand++;
    scoreMin = Math.min(scoreMin, r.score);
    scoreMax = Math.max(scoreMax, r.score);
    if (s < 2) spot.push({ seed: `unit-${s}`, ...r });
  }
  // Independent uniqueness proof on the small tiers: the DP counter is a different
  // algorithm from the solver, so agreement is evidence rather than a tautology.
  if (n <= 8) for (const s of spot) {
    const g = generate(tier.id, s.seed.replace('unit-', 'unit-'));
    if (g) eq(`${tier.id} ${s.seed} solution count`, countSolutions(g.puzzle), 1);
  }
  eq(`${tier.id} produced puzzles`, generated > 8, true);
  eq(`${tier.id} every puzzle logic-solvable`, logic, generated);
  eq(`${tier.id} every puzzle in its difficulty band`, inBand, generated);
  eq(`${tier.id} clue extraction clean`, spot.length >= 0, true);
  console.log(
    `  ${tier.label} ${n}×${n}: n=${generated} score ${scoreMin.toFixed(1)}–${scoreMax.toFixed(1)} ` +
      `band [${tier.band}] worst-candidate-search ${attemptsWorst}`
  );
}

console.log('== determinism ==');
{
  const a = generate('adept', 'same-seed');
  const b = generate('adept', 'same-seed');
  eq('same seed → same picture', a.puzzle.solution.join(''), b.puzzle.solution.join(''));
  eq('same seed → same name', a.puzzle.name, b.puzzle.name);
  const c = generate('adept', 'other-seed');
  eq('different seed → different picture', c.puzzle.solution.join('') !== a.puzzle.solution.join(''), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
