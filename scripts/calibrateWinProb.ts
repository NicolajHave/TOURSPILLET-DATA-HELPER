// scripts/calibrateWinProb.ts
// Calibrate the win-probability sharpening exponent γ used by the surface's
// forward-looking team bonus: P(rider i wins) ∝ strength_i^γ.
//
// A linear share (γ=1) is far too flat — with ~150 riders a dominant team gets
// ~7% when reality is 30-50%. We fit γ by maximum log-likelihood of the ACTUAL
// stage winners on TdF 2025 + Vuelta 2025 (no-lookahead strengths, same
// evStrength the surface uses). Dauphiné/Suisse 2026 are kept as a small
// out-of-sample check.
//
//   npx tsx scripts/calibrateWinProb.ts
import { fileURLToPath } from 'node:url';
import { type Result } from '../src/lib/form';
import { evStrength } from '../src/lib/evModel';
import { loadRace } from '../src/lib/raceData';
import { mean } from '../src/lib/valueFormula';

const PCS = fileURLToPath(new URL('../fixtures/pcs', import.meta.url));
const EPS = 0.01; // strength floor so zero-history riders don't zero the denominator

const races = [
  ...loadRace(PCS, 'TdF', 'tour-de-france', 2025, false),
  ...loadRace(PCS, 'Vuelta', 'vuelta-a-espana', 2025, true),
  ...loadRace(PCS, 'Dauphine26', 'dauphine', 2026, true),
  ...loadRace(PCS, 'Suisse26', 'tour-de-suisse', 2026, true),
].sort((a, b) => a.date.localeCompare(b.date) || a.stageNo - b.stageNo);

// walk the timeline once, collect (strengths[], winnerIdx) per stage
interface Obs { set: 'fit' | 'holdout'; s: number[]; win: number; }
const history = new Map<string, Result[]>();
const obs: Obs[] = [];
for (const st of races) {
  const asOf = new Date(st.date);
  const withPrior = st.finishers.filter((x) => (history.get(x.slug) ?? []).length > 0);
  const winner = st.finishers.find((x) => x.rank === 1);
  if (withPrior.length >= 20 && winner) {
    const s = withPrior.map((x) => Math.max(EPS, evStrength(history.get(x.slug)!, asOf, st.profile)));
    const win = withPrior.findIndex((x) => x.slug === winner.slug);
    if (win >= 0) obs.push({ set: st.race.endsWith('26') ? 'holdout' : 'fit', s, win });
  }
  for (const x of st.finishers) {
    if (!history.has(x.slug)) history.set(x.slug, []);
    history.get(x.slug)!.push({ riderId: 0, date: st.date, profile: st.profile, rank: x.rank, finished: true });
  }
}

const logLik = (o: Obs, g: number) => {
  let denom = 0; for (const v of o.s) denom += Math.pow(v, g);
  return Math.log(Math.pow(o.s[o.win], g) / denom);
};
console.log('═'.repeat(70));
console.log('  WIN-PROB γ-KALIBRERING — P(i vinder) ∝ strength^γ (max log-lik af vindere)');
console.log('═'.repeat(70));
console.log(`  fit: ${obs.filter((o) => o.set === 'fit').length} etaper (TdF+Vuelta 2025) · holdout: ${obs.filter((o) => o.set === 'holdout').length} (2026)`);
console.log('\n    γ    fit-loglik   holdout-loglik   (mindre negativt = bedre)');
let best = { g: 1, ll: -Infinity };
for (const g of [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8]) {
  const fit = mean(obs.filter((o) => o.set === 'fit').map((o) => logLik(o, g)));
  const ho = mean(obs.filter((o) => o.set === 'holdout').map((o) => logLik(o, g)));
  if (fit > best.ll) best = { g, ll: fit };
  console.log(`  ${String(g).padStart(4)}   ${fit.toFixed(3).padStart(9)}   ${ho.toFixed(3).padStart(12)}`);
}
console.log(`\n  ⇒ bedste γ (fit) = ${best.g}`);
// sanity: implied top-team win prob at best γ, on the 2026 holdout stages
const g = best.g;
for (const o of obs.filter((x) => x.set === 'holdout').slice(-3)) {
  const denom = o.s.reduce((a, v) => a + Math.pow(v, g), 0);
  const pTop = Math.max(...o.s.map((v) => Math.pow(v, g) / denom));
  console.log(`  holdout-eksempel: P(stærkeste rytter vinder) = ${(pTop * 100).toFixed(0)}%`);
}
console.log('  → sæt WIN_PROB_GAMMA i src/lib/evModel.ts til bedste γ.');
console.log('═'.repeat(70));
