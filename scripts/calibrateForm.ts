// scripts/calibrateForm.ts
// TRIN 2 sanity-gate: does the recency-weighted FORM + PROFILE-FIT signal
// actually predict finishing position on real data (TdF 2025), with strict
// no-lookahead? This must pass before we tune/trust the full forecaster.
//
// For each stage in chronological order we compute each rider's form/profileFit
// from results STRICTLY BEFORE that stage's date, then measure how well that
// predicts the actual finish. We also run a captain pick-off vs baselines.
//
//   npx tsx scripts/calibrateForm.ts
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { form, profileFit, placingScore, type Result } from '../src/lib/form';
import { classifyStage, type StageProfile } from '../src/lib/stageProfile';
import { hasUsableResults } from '../src/lib/parsePcsExport';
import { pearson, mean } from '../src/lib/valueFormula';

const f = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const RACE = 'tour-de-france-2025';

// --- load stage profiles (date + classified profile) -----------------------
const stagesFile = JSON.parse(readFileSync(f(`fixtures/pcs/${RACE}-stages.json`), 'utf8'));
const meta = new Map<number, { date: string; profile: StageProfile }>();
for (const s of stagesFile.stages) {
  const [dd, mm] = (s.date ?? '').split('/');
  const date = dd && mm ? `${stagesFile.race.year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}` : `${stagesFile.race.year}-07-01`;
  const profile = classifyStage({
    distanceKm: s.distanceKm ?? 0, verticalM: s.verticalM ?? 0, profileScore: s.profileScore ?? undefined,
    parcoursType: s.parcoursType ?? undefined, summitFinish: s.summitFinish ?? undefined, discipline: s.discipline ?? 'road',
  });
  meta.set(s.stageNo, { date, profile });
}

// --- load all stage results ------------------------------------------------
interface StageData { stageNo: number; date: string; profile: StageProfile; rows: Array<{ slug: string; rank: number | null }>; }
const stages: StageData[] = [];
for (const file of readdirSync(f('fixtures/pcs'))) {
  const m = file.match(new RegExp(`^${RACE}-stage-(\\d+)\\.json$`));
  if (!m) continue;
  const j = JSON.parse(readFileSync(f(`fixtures/pcs/${file}`), 'utf8'));
  if (!hasUsableResults(j.results)) { console.warn(`skip (no usable result): ${file}`); continue; }
  const info = meta.get(+m[1]);
  if (!info) { console.warn(`mangler profil for etape ${m[1]}`); continue; }
  stages.push({ stageNo: +m[1], date: info.date, profile: info.profile, rows: j.results.map((r: any) => ({ slug: r.riderSlug, rank: r.rank })) });
}
stages.sort((a, b) => a.date.localeCompare(b.date) || a.stageNo - b.stageNo);

// per-rider result history (built incrementally to guarantee no-lookahead)
const history = new Map<string, Result[]>();
const cumPlacing = new Map<string, number>(); // simple "season points so far" baseline

const kr = (n: number) => n.toFixed(3);
const pad = (s: any, n: number) => String(s).padStart(n);
console.log('═'.repeat(74));
console.log('  FORM-SIGNAL VALIDERING — TdF 2025 (no-lookahead sanity-gate)');
console.log('═'.repeat(74));
console.log('  Korrelation(prior form, placingScore) pr. etape. Positiv = form');
console.log('  forudsiger placering. n = ryttere med mindst ét tidligere resultat.\n');
console.log('  E  profile   n   corr(form)  corr(fit)   kaptajn-pick: form  | bedst-hidtil | felt-gns');

const corrForm: number[] = [], corrFit: number[] = [];
const capForm: number[] = [], capPrior: number[] = [], capField: number[] = [];

for (const st of stages) {
  const asOf = new Date(st.date);
  // build prediction rows from STRICTLY-PRIOR history
  const pred = st.rows
    .filter((r) => r.rank != null)
    .map((r) => {
      const hist = history.get(r.slug) ?? [];
      return {
        slug: r.slug, rank: r.rank as number,
        ps: placingScore(r.rank as number),
        form: form(hist, asOf), fit: profileFit(hist, st.profile, asOf),
        prior: cumPlacing.get(r.slug) ?? 0,
        hasPrior: hist.length > 0,
      };
    });
  const withPrior = pred.filter((p) => p.hasPrior);

  if (withPrior.length >= 5) {
    const cf = pearson(withPrior.map((p) => p.form), withPrior.map((p) => p.ps));
    const cfit = pearson(withPrior.map((p) => p.fit), withPrior.map((p) => p.ps));
    if (!isNaN(cf)) corrForm.push(cf);
    if (!isNaN(cfit)) corrFit.push(cfit);

    // captain pick-off: actual placingScore of the rider we'd have picked
    const byForm = [...withPrior].sort((a, b) => b.form - a.form)[0];
    const byPrior = [...withPrior].sort((a, b) => b.prior - a.prior)[0];
    const fieldAvg = mean(pred.map((p) => p.ps));
    capForm.push(byForm.ps); capPrior.push(byPrior.ps); capField.push(fieldAvg);

    console.log(`  ${pad(st.stageNo, 2)} ${st.profile.padEnd(9)} ${pad(withPrior.length, 3)}   ${pad(kr(cf), 9)}  ${pad(kr(cfit), 9)}   ${pad(kr(byForm.ps), 9)}  | ${pad(kr(byPrior.ps), 10)} | ${pad(kr(fieldAvg), 7)}`);
  } else {
    console.log(`  ${pad(st.stageNo, 2)} ${st.profile.padEnd(9)} ${pad(withPrior.length, 3)}   (for tidligt — utilstrækkelig historik)`);
  }

  // NOW append this stage's results to history (after prediction → no leakage)
  for (const r of st.rows) {
    if (!history.has(r.slug)) history.set(r.slug, []);
    history.get(r.slug)!.push({ riderId: 0, date: st.date, profile: st.profile, rank: r.rank, finished: r.rank != null });
    if (r.rank != null) cumPlacing.set(r.slug, (cumPlacing.get(r.slug) ?? 0) + placingScore(r.rank));
  }
}

console.log('\n' + '─'.repeat(74));
console.log('  SAMLET');
console.log(`  Gns. corr(form, placingScore):   ${kr(mean(corrForm))}   (over ${corrForm.length} etaper m. data)`);
console.log(`  Gns. corr(profileFit, placing):  ${kr(mean(corrFit))}`);
console.log(`  Kaptajn-pick gns. placingScore:  form ${kr(mean(capForm))}  |  bedst-hidtil ${kr(mean(capPrior))}  |  felt-gns ${kr(mean(capField))}`);
const lift = mean(capForm) - mean(capField);
console.log(`  Form-kaptajn løft over felt-gns:  ${kr(lift)} placingScore/etape  (${lift > 0 ? 'POSITIV' : 'ingen'} edge)`);

console.log('\n  VURDERING:');
const cm = mean(corrForm);
if (cm > 0.15) console.log('  ✓ Form forudsiger placering (positiv korr.). Sanity-gate bestået for FORM.');
else console.log('  ⚠ Svag/ingen form-korrelation — sandsynligvis cold-start (kun within-race historik).');
const coldStages = stages.length - corrForm.length;
console.log(`  ⚠ ${coldStages} etaper havde for lidt historik (within-race cold-start). profileFit er`);
console.log('    særligt tynd (kræver tidligere etape af SAMME profil). → stærk grund til at');
console.log('    hente FØR-TdF-data (Tour de Suisse 2025, forår) for at fodre form-signalet.');
console.log('═'.repeat(74));
