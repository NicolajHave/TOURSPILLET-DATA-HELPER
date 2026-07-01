// scripts/buildWeb.ts
// Build step for the live paper-trade surface (public/index.html). Generates
// public/data/form-snapshot.json from the 2026 race results we have so far
// (Dauphiné, Suisse, and Tour de France 2026 once stages land). It precomputes
// each rider's no-lookahead form + profileFit-per-profile as-of the latest
// result, plus the value-curve coefficients. The page joins this to the daily
// holdet snapshot (pasted in-browser) by normalised name.
//
// Re-runs automatically on every Vercel deploy (vercel.json buildCommand), so as
// you upload new stage results to fixtures/pcs/ the live form refreshes.
//
//   npm run build:web
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { form, profileFit, type Result } from '../src/lib/form';
import { classifyStage, type StageProfile } from '../src/lib/stageProfile';
import { loadRace } from '../src/lib/raceData';
import { nameKey, mean } from '../src/lib/valueFormula';
import { coeffsFromArtifact } from '../src/lib/forecaster';
import { EV_BETA } from '../src/lib/evModel';

const f = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const PCS = f('fixtures/pcs');
const PROFILES: StageProfile[] = ['sprint', 'punch', 'break', 'mountain', 'itt'];

// discover 2026 races that have a stages file
const races = readdirSync(PCS)
  .map((x) => x.match(/^(.+)-2026-stages\.json$/))
  .filter(Boolean)
  .map((m) => m![1]);

const stages = races.flatMap((slug) => loadRace(PCS, slug, slug, 2026, true));
stages.sort((a, b) => a.date.localeCompare(b.date) || a.stageNo - b.stageNo);

// build per-rider result history (keyed by normalised name) + display name
const history = new Map<string, Result[]>();
const display = new Map<string, string>();
const rawNameByKey = new Map<string, string>();
for (const st of stages) {
  for (const fin of st.finishers) {
    const key = nameKey(fin.slug.replace(/-/g, ' '));
    if (!history.has(key)) history.set(key, []);
    history.get(key)!.push({ riderId: 0, date: st.date, profile: st.profile, rank: fin.rank, finished: true });
    if (!rawNameByKey.has(key)) rawNameByKey.set(key, fin.slug);
  }
}

// as-of = day after the latest result (≈ the next stage)
const latest = stages.length ? stages[stages.length - 1].date : '2026-07-04';
const asOf = new Date(new Date(latest).getTime() + 86_400_000);

const riders = [...history.entries()].map(([key, results]) => {
  const fit: Record<string, number> = {};
  for (const p of PROFILES) fit[p] = profileFit(results, p, asOf);
  return { key, name: rawNameByKey.get(key)!, form: form(results, asOf), fit, n: results.length };
});

const coeffs = coeffsFromArtifact(JSON.parse(readFileSync(f('artifacts/value-formula.json'), 'utf8')));

// TdF 2026 ROUTE (prediction target, GUARDRAIL: stages only, never results) —
// scraped overview from PCS. When present, the surface auto-fills tomorrow's
// profile + the transfer horizon (E+1..E+3) from the stage number.
let route: Array<{ stageNo: number; date: string | null; profile: StageProfile }> | null = null;
try {
  const rt = JSON.parse(readFileSync(f('fixtures/pcs/tour-de-france-2026-stages.json'), 'utf8'));
  route = rt.stages
    .filter((s: any) => s.stageNo != null)
    .sort((a: any, b: any) => a.stageNo - b.stageNo)
    .map((s: any) => {
      const [dd, mm] = (s.date ?? '').split(/[/.]/);
      return {
        stageNo: s.stageNo,
        date: dd && mm ? `2026-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}` : null,
        profile: classifyStage({
          distanceKm: s.distanceKm ?? 0, verticalM: s.verticalM ?? 0,
          profileScore: s.profileScore ?? undefined, parcoursType: s.parcoursType ?? undefined,
          summitFinish: s.summitFinish ?? undefined, discipline: s.discipline ?? 'road',
        }),
      };
    });
  console.log(`route: ${route!.length} TdF 2026-etaper klassificeret (auto-horisont aktiv).`);
} catch { console.log('route: fixtures/pcs/tour-de-france-2026-stages.json mangler — horisont-profiler forbliver manuelle.'); }

const out = {
  generatedAt: asOf.toISOString().slice(0, 10),
  races,
  stageCount: stages.length,
  evBeta: EV_BETA,
  valueCoeffs: coeffs,
  route,
  riders,
};
mkdirSync(f('public/data'), { recursive: true });
writeFileSync(f('public/data/form-snapshot.json'), JSON.stringify(out, null, 0));
console.log(`form-snapshot: ${riders.length} ryttere fra ${races.join(', ')} (${stages.length} etaper), as-of ${out.generatedAt}.`);
console.log(`gns. resultater/rytter: ${mean(riders.map((r) => r.n)).toFixed(1)}. → public/data/form-snapshot.json`);
