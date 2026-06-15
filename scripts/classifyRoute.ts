// scripts/classifyRoute.ts
// TRIN 4: classify the TdF 2026 ROUTE (prediction target) with classifyStage()
// and report the labelling for verification.
//
// HARD GUARDRAIL: these stages are TARGETS, never training data. The script
//   - refuses any stage row that carries results/rank (targets must have none),
//   - forces hasResults=false / isTarget=true on every output row,
// so route stages can never leak into calibration or backtest.
//
//   npx tsx scripts/classifyRoute.ts [path-to-filled-seed.json]
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { classifyStage, type StageFeatures, type ParcoursType, type Discipline } from '../src/lib/stageProfile';

const f = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const inPath = process.argv[2] ?? f('fixtures/route/tour-de-france-2026-stages.seed.json');
const outPath = f('fixtures/route/tour-de-france-2026-stages.classified.json');

interface SeedStage {
  stageNo: number; date: string | null;
  distanceKm: number | null; verticalM: number | null; profileScore: number | null;
  parcoursType: ParcoursType | null; summitFinish: boolean | null;
  discipline: Discipline; notes?: string;
  results?: unknown; rank?: unknown; // must NOT be present (guardrail)
}

const seed = JSON.parse(readFileSync(inPath, 'utf8')) as { race: any; stages: SeedStage[] };
const pad = (s: any, n: number) => String(s ?? '–').padEnd(n);

const classified = seed.stages.map((s) => {
  // GUARDRAIL: a target stage may never carry results.
  if ('results' in s || 'rank' in s) {
    throw new Error(`Etape ${s.stageNo}: route-mål må ALDRIG have results/rank. Afbryder for at undgå datalækage.`);
  }
  const feat: StageFeatures = {
    distanceKm: s.distanceKm ?? 0,
    verticalM: s.verticalM ?? 0,
    profileScore: s.profileScore ?? undefined,
    parcoursType: s.parcoursType ?? undefined,
    summitFinish: s.summitFinish ?? undefined,
    discipline: s.discipline ?? 'road',
  };
  const filled = s.distanceKm != null || s.verticalM != null || s.parcoursType != null || s.profileScore != null || s.discipline !== 'road';
  return { ...s, profile: classifyStage(feat), hasResults: false as const, isTarget: true as const, _filled: filled };
});

console.log('═'.repeat(72));
console.log('  TdF 2026 RUTE — klassifikation (FORUDSIGELSES-MÅL, ikke træningsdata)');
console.log('═'.repeat(72));
console.log('  E   discipl  parcoursType            vert  profile     notes');
for (const s of classified) {
  console.log(`  ${pad(s.stageNo, 3)} ${pad(s.discipline, 7)} ${pad(s.parcoursType, 22)} ${pad(s.verticalM, 5)} ${pad(s.profile, 10)} ${s._filled ? '' : '⚠ UDFYLD'} ${s.notes ?? ''}`.trimEnd());
}

const unfilled = classified.filter((s) => !s._filled).length;
console.log('─'.repeat(72));
if (unfilled > 0) {
  console.log(`  ⚠ ${unfilled}/${classified.length} etaper er endnu UDFYLDT MED NULL → profilen er kun en`);
  console.log(`    placeholder ('sprint' som default). Udfyld ${inPath.split('/').pop()} fra den`);
  console.log(`    officielle rute og kør igen. (Mærkningen nedenfor er ikke gyldig før udfyldt.)`);
} else {
  console.log('  ✓ Alle etaper udfyldt. Verificér mærkningen ovenfor — særligt uge 3 /');
  console.log('    dobbelt Alpe d\'Huez (summitFinish=true ⇒ profile=mountain).');
}

// write classified output WITHOUT the internal _filled flag, guardrail enforced
const out = {
  race: seed.race,
  guardrail: { hasResults: false, isTarget: true, note: 'Route = prediction target only. Never join results; never use in calibration/backtest.' },
  stages: classified.map(({ _filled, ...rest }) => rest),
};
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`\n  → skrevet til ${outPath.split('/').slice(-2).join('/')} (hasResults=false på alle ${out.stages.length} etaper)`);
console.log('═'.repeat(72));
