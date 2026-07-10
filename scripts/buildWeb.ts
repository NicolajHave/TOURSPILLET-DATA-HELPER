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
import { EV_BETA, WIN_PROB_GAMMA, WIN_PROB_GAMMA_BY_PROFILE, DNF_RATE_BY_PROFILE } from '../src/lib/evModel';

const f = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const PCS = f('fixtures/pcs');
const PROFILES: StageProfile[] = ['sprint', 'punch', 'break', 'mountain', 'itt', 'ttt'];

// discover 2026 races that have a stages file
const races = readdirSync(PCS)
  .map((x) => x.match(/^(.+)-2026-stages\.json$/))
  .filter(Boolean)
  .map((m) => m![1]);

const stages = races.flatMap((slug) => loadRace(PCS, slug, slug, 2026, true));
stages.sort((a, b) => a.date.localeCompare(b.date) || a.stageNo - b.stageNo);

// EXACT-profile index from every stages-file we have: raceSlug-year-stageNo -> profile.
const profileIndex = new Map<string, StageProfile>();
for (const file of readdirSync(PCS)) {
  const m = file.match(/^(.+)-(\d{4})-stages\.json$/);
  if (!m) continue;
  const rt = JSON.parse(readFileSync(f(`fixtures/pcs/${file}`), 'utf8'));
  for (const s of rt.stages ?? []) {
    if (s.stageNo == null) continue;
    profileIndex.set(`${rt.race?.slug ?? m[1]}-${m[2]}-${s.stageNo}`, classifyStage({
      distanceKm: s.distanceKm ?? 0, verticalM: s.verticalM ?? 0, profileScore: s.profileScore ?? undefined,
      parcoursType: s.parcoursType ?? undefined, summitFinish: s.summitFinish ?? undefined, discipline: s.discipline ?? 'road',
    }));
  }
}

// PCS serves some races under a different canonical slug on rider pages than on
// the race overview. Map rider-row slug -> our stages-file slug for exact lookup.
const SLUG_ALIAS: Record<string, string> = { 'tour-auvergne-rhone-alpes': 'dauphine' };

const history = new Map<string, Result[]>();
const rawNameByKey = new Map<string, string>();

// PRIMARY history source: rider season files (whole-season, per rider). Profile
// per row = exact stages-file lookup, else vert/km/profileScore fallback. Drop
// classification rows (standings, would double-count the stage finishes).
const riderFiles = readdirSync(f('fixtures/riders')).filter((x) => /^rider-.*\.json$/.test(x));
const cov = { exact: 0, fallback: 0, dropped: 0 };
for (const file of riderFiles) {
  const j = JSON.parse(readFileSync(f(`fixtures/riders/${file}`), 'utf8'));
  const key = nameKey(j.rider.name);
  rawNameByKey.set(key, j.rider.name);
  if (!history.has(key)) history.set(key, []);
  for (const r of j.results ?? []) {
    if (r.rowType === 'classification' || !r.date || r.rank == null) { if (r.rowType === 'classification') cov.dropped++; continue; }
    const slug = SLUG_ALIAS[r.raceSlug] ?? r.raceSlug;
    const exact = r.stageNo != null ? profileIndex.get(`${slug}-${r.year}-${r.stageNo}`) : undefined;
    const profile = exact ?? classifyStage({ distanceKm: r.distanceKm ?? 0, verticalM: r.verticalM ?? 0, discipline: r.discipline ?? 'road' });
    exact ? cov.exact++ : cov.fallback++;
    history.get(key)!.push({ riderId: 0, date: r.date, profile, rank: r.rank, finished: true });
  }
}
// Keys der stammer fra en rytter-fil (sæson-historik til juni). Rytter-filerne
// er hentet FØR Touren (capturedAt ~30/6), så tour-de-france-2026-etaperne er
// IKKE i dem → de kan foldes ind uden dobbelttælling. Dauphiné/Suisse/Giro er
// derimod allerede i filerne, så dem må vi ikke tilføje igen.
const filedKeys = new Set(history.keys());
// SECONDARY: 2026 stage results. For ryttere UDEN sæson-fil: alle etaper
// (cold-start). For ryttere MED fil: KUN den live Tour (E1+), så deres form
// opdateres løbende med tourens egne resultater, uden at dobbelttælle for-løb.
let filled = 0, liveFolded = 0;
for (const st of stages) {
  for (const fin of st.finishers) {
    const key = nameKey(fin.slug.replace(/-/g, ' '));
    if (filedKeys.has(key)) {
      if (st.race !== 'tour-de-france') continue; // for-løb ligger allerede i filen
      liveFolded++;
    } else {
      if (!rawNameByKey.has(key)) { rawNameByKey.set(key, fin.slug); filled++; }
      if (!history.has(key)) history.set(key, []);
    }
    history.get(key)!.push({ riderId: 0, date: st.date, profile: st.profile, rank: fin.rank, finished: true });
  }
}
console.log(`riders: ${riderFiles.length} sæson-filer (${cov.exact} eksakt + ${cov.fallback} fallback profiler, ${cov.dropped} classification droppet) + ${filled} kun-fra-stage-filer + ${liveFolded} live-Tour-resultater foldet ind i eksisterende ryttere.`);

// as-of = SENESTE resultatdato i data (dynamisk!). Hardcodet dato ville få
// no-lookahead-reglen i form.ts til at IGNORERE nye tour-etaper efterhånden
// som de uploades — formen skal altid stå på "dagen for seneste resultat".
let maxDate = '2026-07-03';
for (const results of history.values()) for (const r of results) if (r.date > maxDate) maxDate = r.date;
const asOf = new Date(maxDate);

const riders = [...history.entries()].map(([key, results]) => {
  const fit: Record<string, number> = {};
  for (const p of PROFILES) fit[p] = profileFit(results, p, asOf);
  // AFLEDT: stejl punch (mur-finale) kræver BÅDE punch og klatreevne — rene
  // sprintere vinder blød punch (drag-spurt) men ender nr. 27-179 på mure
  // (TdF25 E2/E4/E7). Ingen historik-rækker klassificeres punch_steep; fittet
  // afledes: 0.6·punch + 0.4·max(mountain, break).
  fit['punch_steep'] = +(0.6 * fit['punch'] + 0.4 * Math.max(fit['mountain'], fit['break'])).toFixed(3);
  return { key, name: rawNameByKey.get(key)!, form: form(results, asOf), fit, n: results.length };
});

const coeffs = coeffsFromArtifact(JSON.parse(readFileSync(f('artifacts/value-formula.json'), 'utf8')));

// TdF 2026 ROUTE (prediction target, GUARDRAIL: stages only, never results) —
// scraped overview from PCS. When present, the surface auto-fills tomorrow's
// profile + the transfer horizon (E+1..E+3) from the stage number.
let route: Array<{ stageNo: number; date: string | null; profile: StageProfile }> | null = null;
try {
  const rt = JSON.parse(readFileSync(f('fixtures/pcs/tour-de-france-2026-stages.json'), 'utf8'));
  let merged = 0;
  route = rt.stages
    .filter((s: any) => s.stageNo != null)
    .sort((a: any, b: any) => a.stageNo - b.stageNo)
    .map((s: any) => {
      // merge per-stage info (pcs-stageinfo.js preview, or the live result scrape
      // once the stage is run — same filename) for vert/km/profileScore. Fixes the
      // hilly_flat ambiguity (break vs sprint needs vertical metres).
      let info: any = {};
      try {
        info = JSON.parse(readFileSync(f(`fixtures/pcs/tour-de-france-2026-stage-${s.stageNo}.json`), 'utf8')).stage ?? {};
        if (info.verticalM != null || info.profileScore != null) merged++;
      } catch { /* no per-stage file yet */ }
      const [dd, mm] = (s.date ?? '').split(/[/.]/);
      const ps = info.profileScore ?? s.profileScore ?? undefined;
      let profile = classifyStage({
        distanceKm: info.distanceKm ?? s.distanceKm ?? 0,
        verticalM: info.verticalM ?? s.verticalM ?? 0,
        profileScore: ps,
        parcoursType: s.parcoursType ?? undefined,
        summitFinish: s.summitFinish ?? undefined, discipline: s.discipline ?? 'road',
      });
      // RUTE-forfinelse (rører ikke historik-klassifikationen): punch med høj
      // absolut hårdhed (ps>=100) = mur-finale (E2 Montjuïc: ps 137) → stejl
      // punch, hvor rene sprintere sorteres fra. Bløde punch (Vuelta-typen,
      // ps 22-25) forbliver 'punch'.
      if (profile === 'punch' && ps !== undefined && ps >= 100) profile = 'punch_steep';
      return { stageNo: s.stageNo, date: dd && mm ? `2026-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}` : null, profile };
    });
  console.log(`route: ${route!.length} TdF 2026-etaper klassificeret (auto-horisont aktiv); ${merged} m. per-etape-info (vert/ps).`);
} catch { console.log('route: fixtures/pcs/tour-de-france-2026-stages.json mangler — horisont-profiler forbliver manuelle.'); }

// ÆGTE GC-stilling fra nyeste TdF-etapefil m. gc-felt (pcs-results v6+): gør
// fladens GC-indkomst/dag deterministisk (stilling × officiel tabel) i stedet
// for model-sandsynligheder. Ældre scrapes uden gc-felt → null (model-fallback).
let actualGc: Array<{ rank: number; name: string }> | null = null;
try {
  const stageFiles = readdirSync(PCS)
    .map((x) => x.match(/^tour-de-france-2026-stage-(\d+)\.json$/))
    .filter(Boolean)
    .sort((a, b) => Number(a![1]) - Number(b![1]));
  for (let i = stageFiles.length - 1; i >= 0; i--) {
    const j = JSON.parse(readFileSync(f(`fixtures/pcs/${stageFiles[i]![0]}`), 'utf8'));
    if (Array.isArray(j.gc) && j.gc.length) { actualGc = j.gc; console.log(`actualGc: samlet stilling efter E${stageFiles[i]![1]} (${j.gc.length} ryttere) → deterministisk GC-kanal.`); break; }
  }
  if (!actualGc) console.log('actualGc: ingen etapefil med gc-felt endnu (re-scrape m. v6-snippet) — GC-kanal = model.');
} catch { /* ok */ }

// Nyeste holdet-snapshot (after-stage-N) bundtes med, så fladen auto-indlæser
// det ved load — manuel paste er så kun nødvendig for at beslutte FØR
// upload/deploy (samme JSON, to veje ind).
let holdetSnapshotFile: string | null = null;
try {
  const hs = readdirSync(f('fixtures/holdet'))
    .map((x) => x.match(/^tour-de-france-2026-after-stage-(\d+)\.json$/))
    .filter(Boolean)
    .sort((a, b) => Number(a![1]) - Number(b![1]));
  if (hs.length) {
    holdetSnapshotFile = hs[hs.length - 1]![0];
    mkdirSync(f('public/data'), { recursive: true });
    writeFileSync(f('public/data/holdet-snapshot.json'), readFileSync(f(`fixtures/holdet/${holdetSnapshotFile}`)));
    console.log(`holdet-snapshot: ${holdetSnapshotFile} bundtet til auto-indlæsning i fladen.`);
  }
} catch { /* ingen holdet-fixtures endnu */ }

const out = {
  generatedAt: asOf.toISOString().slice(0, 10),
  holdetSnapshotFile,
  races,
  stageCount: stages.length,
  evBeta: EV_BETA,
  winProbGamma: WIN_PROB_GAMMA,
  winProbGammaByProfile: WIN_PROB_GAMMA_BY_PROFILE,
  dnfRateByProfile: DNF_RATE_BY_PROFILE,
  valueCoeffs: coeffs,
  route,
  actualGc,
  riders,
};
mkdirSync(f('public/data'), { recursive: true });
writeFileSync(f('public/data/form-snapshot.json'), JSON.stringify(out, null, 0));
console.log(`form-snapshot: ${riders.length} ryttere fra ${races.join(', ')} (${stages.length} etaper), as-of ${out.generatedAt}.`);
console.log(`gns. resultater/rytter: ${mean(riders.map((r) => r.n)).toFixed(1)}. → public/data/form-snapshot.json`);
