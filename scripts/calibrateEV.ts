// scripts/calibrateEV.ts
// The EV model's ranking layer: strength = form + β·profileFit, calibrated on
// TdF 2025 (where we have outcomes), validated on Vuelta 2025 as a HOLDOUT
// (params locked). Strict no-lookahead: every stage's prediction uses only
// results dated BEFORE that stage. Form history is GLOBAL across races, so
// Vuelta riders carry their TdF form (TdF is before Vuelta — legitimate).
//
// Metric: per stage, rank riders by strength, take the top-15, and measure how
// many of the ACTUAL top-10 finishers we caught (recall@15). Reported PER STAGE
// PROFILE so we see where the model is strong/weak (break days are notoriously
// unpredictable — we surface that, not hide it in an average).
//
// Baselines to beat: (a) random, (b) "favourite" proxy = cumulative prior form.
//   (We lack holdet prices for TdF/Vuelta, so cumulative form is the market-
//    value stand-in. A true price baseline needs PCS rankings — a later scrape.)
//
//   npx tsx scripts/calibrateEV.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { form, profileFit, placingScore, type Result } from '../src/lib/form';
import { classifyStage, type StageProfile, type StageFeatures } from '../src/lib/stageProfile';
import { hasUsableResults } from '../src/lib/parsePcsExport';
import { mean } from '../src/lib/valueFormula';

const f = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const pad = (s: any, n: number) => String(s).padEnd(n);
const r3 = (n: number) => (isNaN(n) ? '–' : n.toFixed(3));

interface StageRec { race: 'TdF' | 'Vuelta'; stageNo: number; date: string; profile: StageProfile; finishers: Array<{ slug: string; rank: number }>; }

function loadRace(race: 'TdF' | 'Vuelta', slug: string, year: number, preferProfileScore: boolean): StageRec[] {
  const stagesFile = JSON.parse(readFileSync(f(`fixtures/pcs/${slug}-${year}-stages.json`), 'utf8'));
  const sMeta = new Map<number, any>();
  for (const s of stagesFile.stages) sMeta.set(s.stageNo, s);

  const out: StageRec[] = [];
  for (let n = 0; n <= 21; n++) {
    let raw: any;
    for (const name of [`${slug}-${year}-stage-${n}.json`]) {
      try { raw = JSON.parse(readFileSync(f(`fixtures/pcs/${name}`), 'utf8')); } catch { /* missing */ }
    }
    if (!raw || !hasUsableResults(raw.results)) continue; // guard: skip all-null (TTT/neutralised)
    const sm = sMeta.get(n) ?? {};
    const [dd, mm] = (sm.date ?? '').split('/');
    const date = dd && mm ? `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}` : `${year}-07-01`;
    // profile: prefer absolute profileScore (Vuelta) else corrected icon (TdF)
    const ps = raw.stage?.profileScore ?? null;
    const feat: StageFeatures = preferProfileScore && ps != null
      ? { distanceKm: raw.stage?.distanceKm ?? 0, verticalM: raw.stage?.verticalM ?? 0, profileScore: ps, discipline: sm.discipline ?? 'road' }
      : { distanceKm: 0, verticalM: sm.verticalM ?? 0, profileScore: sm.profileScore ?? undefined, parcoursType: sm.parcoursType ?? undefined, summitFinish: sm.summitFinish ?? undefined, discipline: sm.discipline ?? 'road' };
    out.push({ race, stageNo: n, date, profile: classifyStage(feat), finishers: raw.results.filter((x: any) => x.rank != null).map((x: any) => ({ slug: x.riderSlug, rank: x.rank })) });
  }
  return out;
}

const tdf = loadRace('TdF', 'tour-de-france', 2025, false);     // corrected icons
const vuelta = loadRace('Vuelta', 'vuelta-a-espana', 2025, true); // absolute profileScore
const all = [...tdf, ...vuelta].sort((a, b) => a.date.localeCompare(b.date) || a.stageNo - b.stageNo);

// ---- evaluation: walk global timeline, predict each stage from prior only ----
interface Eval { race: string; profile: StageProfile; recallModel: number; recallMarket: number; recallRandom: number; }
function run(beta: number): Eval[] {
  const history = new Map<string, Result[]>();
  const cum = new Map<string, number>(); // cumulative prior placingScore (favourite proxy)
  const evals: Eval[] = [];
  for (const st of all) {
    const asOf = new Date(st.date);
    const N = st.finishers.length;
    const k = Math.min(10, N);
    const actualTop = new Set(st.finishers.filter((x) => x.rank <= 10).map((x) => x.slug));
    const scored = st.finishers.map((x) => {
      const h = history.get(x.slug) ?? [];
      const strength = form(h, asOf) + beta * profileFit(h, st.profile, asOf);
      return { slug: x.slug, strength, market: cum.get(x.slug) ?? 0 };
    });
    const top = (key: 'strength' | 'market') => new Set([...scored].sort((a, b) => b[key] - a[key]).slice(0, 15).map((s) => s.slug));
    const recall = (pred: Set<string>) => [...pred].filter((s) => actualTop.has(s)).length / k;
    evals.push({
      race: st.race, profile: st.profile,
      recallModel: recall(top('strength')),
      recallMarket: recall(top('market')),
      recallRandom: Math.min(1, 15 / N),
    });
    // append AFTER predicting (no leakage)
    for (const x of st.finishers) {
      if (!history.has(x.slug)) history.set(x.slug, []);
      history.get(x.slug)!.push({ riderId: 0, date: st.date, profile: st.profile, rank: x.rank, finished: true });
      cum.set(x.slug, (cum.get(x.slug) ?? 0) + placingScore(x.rank));
    }
  }
  return evals;
}

// ---- calibrate β on TdF ONLY (maximise mean recall@15), then lock -----------
const GRID = [0, 0.5, 1, 1.5, 2, 3, 5, 8, 12, 20];
let best = { beta: 0, recall: -1 };
for (const beta of GRID) {
  const ev = run(beta).filter((e) => e.race === 'TdF');
  const m = mean(ev.map((e) => e.recallModel));
  if (m > best.recall) best = { beta, recall: m };
}
const evals = run(best.beta);

console.log('═'.repeat(78));
console.log('  EV-MODEL — ranking-kalibrering (recall@15 af faktiske top-10), no-lookahead');
console.log('═'.repeat(78));
console.log(`  strength = form + β·profileFit.  β kalibreret på TdF 2025 = ${best.beta} (låst).`);
console.log('  Vuelta 2025 = HOLDOUT (β rørt ikke). Baselines: favorit-proxy (kumulativ form), tilfældig.');
console.log('  Favorit-proxy = markedsværdi-stand-in (ingen holdet-priser for TdF/Vuelta).\n');

const PROFILES: StageProfile[] = ['sprint', 'punch', 'break', 'mountain', 'itt'];
for (const race of ['TdF', 'Vuelta'] as const) {
  console.log(`── ${race}${race === 'Vuelta' ? '  (HOLDOUT)' : '  (kalibrering)'} ──────────────────────────────────────────`);
  console.log('  profil     n   model   favorit  tilfældig   edge(model−favorit)');
  for (const p of PROFILES) {
    const e = evals.filter((x) => x.race === race && x.profile === p);
    if (!e.length) { console.log(`  ${pad(p, 9)}  0   –`); continue; }
    const m = mean(e.map((x) => x.recallModel)), mk = mean(e.map((x) => x.recallMarket)), rnd = mean(e.map((x) => x.recallRandom));
    const edge = m - mk;
    const flag = edge < 0 ? '  ⚠ UNDER favorit' : edge < 0.05 ? '  ~ marginal' : '';
    console.log(`  ${pad(p, 9)} ${pad(e.length, 2)}  ${r3(m)}   ${r3(mk)}   ${r3(rnd)}     ${(edge >= 0 ? '+' : '') + r3(edge)}${flag}`);
  }
  const E = evals.filter((x) => x.race === race);
  const m = mean(E.map((x) => x.recallModel)), mk = mean(E.map((x) => x.recallMarket)), rnd = mean(E.map((x) => x.recallRandom));
  console.log(`  ${pad('SAMLET', 9)} ${pad(E.length, 2)}  ${r3(m)}   ${r3(mk)}   ${r3(rnd)}     ${(m - mk >= 0 ? '+' : '') + r3(m - mk)}\n`);
}

// ---- honest verdict --------------------------------------------------------
const vu = evals.filter((x) => x.race === 'Vuelta');
const vModel = mean(vu.map((x) => x.recallModel)), vMarket = mean(vu.map((x) => x.recallMarket));
console.log('─'.repeat(78));
console.log('  VURDERING (ærlig):');
console.log(`  • Holdout (Vuelta): model ${r3(vModel)} vs favorit-proxy ${r3(vMarket)}  → ${vModel > vMarket + 0.02 ? 'modellen HAR edge over favorit-proxy' : vModel < vMarket - 0.02 ? 'modellen SLÅR IKKE favorit-proxy — svag edge' : 'stort set lige med favorit-proxy (lille edge)'}.`);
const weak = PROFILES.filter((p) => { const e = vu.filter((x) => x.profile === p); return e.length && mean(e.map((x) => x.recallModel)) <= mean(e.map((x) => x.recallMarket)); });
if (weak.length) console.log(`  • Svage profiler på holdout (model ≤ favorit): ${weak.join(', ')} — forventet for break/udbrud.`);
console.log('  • Forbehold: within-2025-form (cold-start for TdF tidlige etaper); Vuelta-profiler fra');
console.log('    profileScore kan ikke skelne bjergankomst fra break (mangler profileScoreFinal);');
console.log('    favorit-proxy er kumulativ form, ikke ægte markedspris. expectedDelta produceres');
console.log('    nedstrøms af forecasteren (strength→Plackett-Luce→værdikurve).');
console.log('═'.repeat(78));
