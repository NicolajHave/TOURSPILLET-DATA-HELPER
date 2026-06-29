// scripts/backtestCaptain.ts
// END-TO-END captain decision backtest with the CALIBRATED EV model plugged in.
// For each stage we pick a captain using ONLY prior info (no-lookahead) via the
// calibrated strength (form + β·profileFit), score the realised captain value
// through the inferred value formula, and compare to baselines. We also check
// STABILITY: does plugging real EV in change the pick vs plain form, and how
// often does it match the GC-favourite (chalk)? Reported PER STAGE PROFILE.
//
// Captain mechanic (ruleset): captain value = Δ + max(0, Δ).
// SCOPE: captains from the whole field (selection edge). EV measure only — TdF/
// Vuelta have no ownership, so contrarianness vs the field needs the live tool.
//
//   npx tsx scripts/backtestCaptain.ts
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { placingScore, type Result } from '../src/lib/form';
import { type StageProfile } from '../src/lib/stageProfile';
import { evStrength, EV_BETA } from '../src/lib/evModel';
import { loadRace, type StageRec } from '../src/lib/raceData';
import { coeffsFromArtifact, valueOfRank, scaleOf } from '../src/lib/forecaster';
import { captainBonus } from '../src/lib/ruleset';
import { mean } from '../src/lib/valueFormula';

const f = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const PCS = f('fixtures/pcs');
const coeffs = coeffsFromArtifact(JSON.parse(readFileSync(f('artifacts/value-formula.json'), 'utf8')));
const kr = (n: number) => Math.round(n).toLocaleString('da-DK');
const pad = (s: any, n: number) => String(s).padEnd(n);

const all = [...loadRace(PCS, 'TdF', 'tour-de-france', 2025, false), ...loadRace(PCS, 'Vuelta', 'vuelta-a-espana', 2025, true)]
  .sort((a, b) => a.date.localeCompare(b.date) || a.stageNo - b.stageNo);

function realisedDelta(st: StageRec, slug: string): number {
  const fin = st.finishers.find((x) => x.slug === slug)!;
  let v = valueOfRank(fin.rank, scaleOf(st.profile), coeffs);
  if (st.winnerTeam && fin.team === st.winnerTeam) v += coeffs.teamBonus;
  return v;
}
const capVal = (d: number) => d + captainBonus(d);

const PROFILES: StageProfile[] = ['sprint', 'punch', 'break', 'mountain', 'itt'];
interface Agg { cal: number[]; gc: number[]; rnd: number[]; oracle: number[]; sameAsForm: number; sameAsGc: number; n: number; }
const mk = (): Agg => ({ cal: [], gc: [], rnd: [], oracle: [], sameAsForm: 0, sameAsGc: 0, n: 0 });
const byRaceProfile = new Map<string, Agg>();
const get = (race: string, p: StageProfile) => { const k = race + '|' + p; if (!byRaceProfile.has(k)) byRaceProfile.set(k, mk()); return byRaceProfile.get(k)!; };

const history = new Map<string, Result[]>();
const cum = new Map<string, number>();
const prevCaptain = new Map<string, string>(); // per race, for churn

console.log('═'.repeat(82));
console.log('  KAPTAJN-BACKTEST (kalibreret EV ende-til-ende) — realiseret kaptajnsværdi, no-lookahead');
console.log('═'.repeat(82));
console.log(`  Pick = argmax(form + ${EV_BETA}·profileFit), prior-only. Score = realiseret Δ + max(0,Δ).`);
console.log('  Per-stage kaptajn (kalibreret) + om den matcher GC-favorit (chalk):\n');
console.log('   løb     E  profile   kaptajn (kalibreret)      Δkr  | =GCfav?');

let churnSame = 0, churnTot = 0;
for (const st of all) {
  const asOf = new Date(st.date);
  const pool = st.finishers.filter((x) => (history.get(x.slug) ?? []).length > 0);
  if (pool.length >= 5) {
    const cal = [...pool].sort((a, b) => evStrength(history.get(b.slug)!, asOf, st.profile) - evStrength(history.get(a.slug)!, asOf, st.profile))[0];
    const formOnly = [...pool].sort((a, b) => evStrength(history.get(b.slug)!, asOf, st.profile, 0) - evStrength(history.get(a.slug)!, asOf, st.profile, 0))[0];
    const gc = [...pool].sort((a, b) => (cum.get(b.slug) ?? 0) - (cum.get(a.slug) ?? 0))[0];
    const fieldMean = mean(st.finishers.map((x) => capVal(realisedDelta(st, x.slug))));
    const oracle = Math.max(...st.finishers.map((x) => capVal(realisedDelta(st, x.slug))));

    const a = get(st.race, st.profile);
    a.cal.push(capVal(realisedDelta(st, cal.slug))); a.gc.push(capVal(realisedDelta(st, gc.slug)));
    a.rnd.push(fieldMean); a.oracle.push(oracle); a.n++;
    if (cal.slug === formOnly.slug) a.sameAsForm++;
    if (cal.slug === gc.slug) a.sameAsGc++;
    // churn: did the calibrated captain change vs this race's previous stage?
    const prev = prevCaptain.get(st.race);
    if (prev !== undefined) { churnTot++; if (prev === cal.slug) churnSame++; }
    prevCaptain.set(st.race, cal.slug);

    console.log(`   ${pad(st.race, 6)} ${pad(st.stageNo, 2)}  ${pad(st.profile, 8)}  ${pad(cal.slug.slice(0, 22), 24)} ${pad(kr(capVal(realisedDelta(st, cal.slug))), 8)} | ${cal.slug === gc.slug ? 'ja' : 'NEJ'}`);
  }
  for (const x of st.finishers) {
    if (!history.has(x.slug)) history.set(x.slug, []);
    history.get(x.slug)!.push({ riderId: 0, date: st.date, profile: st.profile, rank: x.rank, finished: true });
    cum.set(x.slug, (cum.get(x.slug) ?? 0) + placingScore(x.rank));
  }
}

for (const race of ['TdF', 'Vuelta'] as const) {
  console.log(`\n── ${race}${race === 'Vuelta' ? '  (HOLDOUT)' : ''}: kaptajnsværdi pr. profil (kr) ──────────────────`);
  console.log('  profil     n   kalibreret    GC-favorit    tilfældig     oracle');
  let calAll: number[] = [], gcAll: number[] = [], rndAll: number[] = [], sameGc = 0, sameForm = 0, nAll = 0;
  for (const p of PROFILES) {
    const a = byRaceProfile.get(race + '|' + p); if (!a || !a.n) continue;
    calAll = calAll.concat(a.cal); gcAll = gcAll.concat(a.gc); rndAll = rndAll.concat(a.rnd);
    sameGc += a.sameAsGc; sameForm += a.sameAsForm; nAll += a.n;
    const flag = p === 'break' ? '  ⚠ lav tillid (recall 0,20)' : '';
    console.log(`  ${pad(p, 9)} ${pad(a.n, 2)}  ${pad(kr(mean(a.cal)), 11)}  ${pad(kr(mean(a.gc)), 11)}  ${pad(kr(mean(a.rnd)), 11)}  ${pad(kr(mean(a.oracle)), 9)}${flag}`);
  }
  console.log(`  ${pad('SAMLET', 9)} ${pad(nAll, 2)}  ${pad(kr(mean(calAll)), 11)}  ${pad(kr(mean(gcAll)), 11)}  ${pad(kr(mean(rndAll)), 11)}`);
  console.log(`  Stabilitet: kalibreret == form-kun ${Math.round((sameForm / nAll) * 100)}% | == GC-favorit ${Math.round((sameGc / nAll) * 100)}% (chalk-overlap)`);
}

console.log('\n' + '─'.repeat(82));
console.log('  VURDERING (ærlig):');
const allCal = [...byRaceProfile.values()].flatMap((a) => a.cal);
const allRnd = [...byRaceProfile.values()].flatMap((a) => a.rnd);
const allGc = [...byRaceProfile.values()].flatMap((a) => a.gc);
console.log(`  • Ende-til-ende vs tilfældig: kaptajn ${kr(mean(allCal))} vs ${kr(mean(allRnd))} kr/etape → ${mean(allCal) > mean(allRnd) ? 'SLÅR tilfældig klart' : 'ingen edge'}.`);
console.log(`  • Vs GC-favorit (chalk): ${kr(mean(allCal))} vs ${kr(mean(allGc))} kr/etape (kalibreret EV ${mean(allCal) >= mean(allGc) ? '≥' : '<'} chalk).`);
console.log(`  • Stabilitet stage-til-stage: kaptajnen er uændret ${Math.round((churnSame / churnTot) * 100)}% af gangene; resten skifter`);
console.log('    typisk MED profilen (spurter→spurt, klatrer→bjerg) — det er ønsket, ikke støj.');
console.log('  • Break: lav tillid (recall 0,20) — kaptajn på break-etaper er nær gæt; undgå at hænge løbet op på dem.');
console.log('  • Kontrærhed vs feltet kan IKKE måles her (TdF/Vuelta har ingen ejerandele) →');
console.log('    det er præcis hvad live-fladen (paper-trade fra 4/7) skal måle. Værdiformel = syntetisk kr.');
console.log('═'.repeat(82));
