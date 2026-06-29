// scripts/backtestCaptain.ts
// TRIN 3 / §3 — value backtest of the CAPTAIN decision on TdF 2025.
// Applies the inferred value formula to the ACTUAL results (realised kr) and,
// for each stage, picks a captain using ONLY prior information (no-lookahead),
// then scores the realised captain value. Compares our form signal against the
// HANDOVER baselines: random captain, and "always the GC favourite".
//
// Captain mechanic (ruleset): the positive part of the value delta is paid again
// to the bank, i.e. captain value = delta + max(0, delta).
//
// SCOPE: v1 captains from the whole field (selection edge), not yet a
// constrained 8-rider squad. Measures EV, not leverage — TdF 2025 has no holdet
// ownership data, so the leverage/under-ownership layer is validated separately
// on Dauphiné. Honest upper-bound "oracle" included for reference.
//
//   npx tsx scripts/backtestCaptain.ts
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { form, placingScore, type Result } from '../src/lib/form';
import { classifyStage, type StageProfile } from '../src/lib/stageProfile';
import { coeffsFromArtifact, valueOfRank, scaleOf } from '../src/lib/forecaster';
import { hasUsableResults } from '../src/lib/parsePcsExport';
import { captainBonus } from '../src/lib/ruleset';
import { mean } from '../src/lib/valueFormula';

const f = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const RACE = 'tour-de-france-2025';
const coeffs = coeffsFromArtifact(JSON.parse(readFileSync(f('artifacts/value-formula.json'), 'utf8')));

// stage meta (date + profile)
const stagesFile = JSON.parse(readFileSync(f(`fixtures/pcs/${RACE}-stages.json`), 'utf8'));
const meta = new Map<number, { date: string; profile: StageProfile }>();
for (const s of stagesFile.stages) {
  const [dd, mm] = (s.date ?? '').split('/');
  const date = dd && mm ? `${stagesFile.race.year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}` : `${stagesFile.race.year}-07-01`;
  meta.set(s.stageNo, { date, profile: classifyStage({ distanceKm: 0, verticalM: 0, parcoursType: s.parcoursType ?? undefined, summitFinish: s.summitFinish ?? undefined, discipline: s.discipline ?? 'road' }) });
}

interface Row { slug: string; rank: number | null; team: string | null; }
interface Stage { stageNo: number; date: string; profile: StageProfile; rows: Row[]; winnerTeam: string | null; }
const stages: Stage[] = [];
for (const file of readdirSync(f('fixtures/pcs'))) {
  const m = file.match(new RegExp(`^${RACE}-stage-(\\d+)\\.json$`));
  if (!m) continue;
  const j = JSON.parse(readFileSync(f(`fixtures/pcs/${file}`), 'utf8'));
  if (!hasUsableResults(j.results)) { console.warn(`skip (no usable result): ${file}`); continue; }
  const info = meta.get(+m[1])!;
  const rows: Row[] = j.results.map((r: any) => ({ slug: r.riderSlug, rank: r.rank, team: r.team ?? null }));
  stages.push({ stageNo: +m[1], date: info.date, profile: info.profile, rows, winnerTeam: (rows.find((r) => r.rank === 1) || {}).team ?? null });
}
stages.sort((a, b) => a.date.localeCompare(b.date) || a.stageNo - b.stageNo);

/** Realised holdet value delta for a rider on a stage (kr), via the formula. */
function realisedDelta(st: Stage, r: Row): number {
  if (r.rank == null) return -coeffs.dnfPenalty;
  const scale = scaleOf(st.profile);
  let v = valueOfRank(r.rank, scale, coeffs);
  if (st.winnerTeam && r.team === st.winnerTeam) v += coeffs.teamBonus; // team bonus
  return v;
}
const captainValue = (d: number) => d + captainBonus(d); // doubles positive part

// strategies accumulate captain value over the race (no-lookahead picks)
const history = new Map<string, Result[]>();
const cumPlacing = new Map<string, number>();
const tot = { form: 0, gc: 0, random: 0, oracle: 0 };
const overlapFormGc: number[] = [];

const kr = (n: number) => Math.round(n).toLocaleString('da-DK');
const pad = (s: any, n: number) => String(s).padStart(n);
console.log('═'.repeat(76));
console.log('  VALUE-BACKTEST — kaptajnsvalg på TdF 2025 (realiseret kr via værdiformlen)');
console.log('═'.repeat(76));
console.log('  Kaptajnsværdi = Δ + max(0,Δ).  Valg no-lookahead; score = faktisk udfald.\n');
console.log('   E  profile    form-kaptajn           Δkr   | GC-fav-kaptajn        Δkr | felt-gns');

for (const st of stages) {
  const asOf = new Date(st.date);
  const finishers = st.rows.filter((r) => r.rank != null);
  // candidate pool = riders with prior history (so form is defined)
  const cand = finishers.map((r) => ({
    r, fForm: form(history.get(r.slug) ?? [], asOf), prior: cumPlacing.get(r.slug) ?? 0,
    hasPrior: (history.get(r.slug) ?? []).length > 0,
    val: realisedDelta(st, r),
  }));
  const pool = cand.filter((c) => c.hasPrior);

  let line = `  ${pad(st.stageNo, 2)}  ${st.profile.padEnd(9)}`;
  if (pool.length >= 5) {
    const byForm = [...pool].sort((a, b) => b.fForm - a.fForm)[0];
    const byGc = [...pool].sort((a, b) => b.prior - a.prior)[0];
    const fieldMean = mean(cand.map((c) => captainValue(c.val)));
    const oracle = Math.max(...cand.map((c) => captainValue(c.val)));
    tot.form += captainValue(byForm.val); tot.gc += captainValue(byGc.val);
    tot.random += fieldMean; tot.oracle += oracle;
    overlapFormGc.push(byForm.r.slug === byGc.r.slug ? 1 : 0);
    line += `  ${byForm.r.slug.slice(0, 20).padEnd(20)} ${pad(kr(captainValue(byForm.val)), 6)} | ${byGc.r.slug.slice(0, 20).padEnd(20)} ${pad(kr(captainValue(byGc.val)), 5)} | ${pad(kr(fieldMean), 7)}`;
  } else line += '  (for tidligt — utilstrækkelig historik)';
  console.log(line);

  for (const r of st.rows) {
    if (!history.has(r.slug)) history.set(r.slug, []);
    history.get(r.slug)!.push({ riderId: 0, date: st.date, profile: st.profile, rank: r.rank, finished: r.rank != null });
    if (r.rank != null) cumPlacing.set(r.slug, (cumPlacing.get(r.slug) ?? 0) + placingScore(r.rank));
  }
}

console.log('\n' + '─'.repeat(76));
console.log('  SAMLET KAPTAJNSVÆRDI OVER LØBET (kr)');
const rows: Array<[string, number]> = [['Form-kaptajn (vores signal)', tot.form], ['GC-favorit-kaptajn (baseline)', tot.gc], ['Tilfældig kaptajn (baseline)', tot.random], ['Oracle (hindsight-loft)', tot.oracle]];
rows.sort((a, b) => b[1] - a[1]).forEach(([n, v], i) => console.log(`  ${i + 1}. ${n.padEnd(34)} ${pad(kr(v), 12)}`));
const edge = tot.form - tot.random, vsGc = tot.form - tot.gc;
console.log('\n  Form-kaptajn vs tilfældig:  ' + (edge >= 0 ? '+' : '') + kr(edge) + ' kr   ⇒ ' + (edge > 0 ? 'POSITIV edge' : 'ingen edge'));
console.log('  Form-kaptajn vs GC-favorit: ' + (vsGc >= 0 ? '+' : '') + kr(vsGc) + ' kr');
console.log('  Form-pick == GC-favorit:    ' + Math.round(mean(overlapFormGc) * 100) + ' % af etaperne  (overlap = chalk)');
console.log('  Form-kaptajn fanger ' + Math.round((tot.form / tot.oracle) * 100) + ' % af oracle-loftet.');
console.log('\n  NB: dette måler EV (kr), IKKE leverage — TdF 2025 har ingen ejerandele.');
console.log('  Den høje chalk-overlap er præcis grunden til at leverage-laget (lav ejerandel)');
console.log('  er en SEPARAT edge, der valideres på Dauphiné-ejerandele.');
console.log('═'.repeat(76));
