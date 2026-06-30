// scripts/ingestPcs.ts
// Runs LOCALLY on your machine (residential IP, your Supabase keys in .env.local).
// Reads every JSON file the snippets produced under fixtures/pcs/ and upserts
// races / race_stages / results into the tourspillet schema.
//
//   npm run ingest:pcs
//
// Two file shapes are accepted:
//   * stages overview:  { race, stages: [...] }      (from pcs-stages.js)
//   * stage results:    { race, stage, results: [...] } (from pcs-results.js)
import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { parsePcsExport, hasUsableResults, type PcsExport } from '../src/lib/parsePcsExport';
import { classifyStage } from '../src/lib/stageProfile';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Mangler NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY i .env.local');
  process.exit(1);
}
const db = createClient(url, key, { db: { schema: 'tourspillet' } });

const dir = join(process.cwd(), 'fixtures', 'pcs');
const files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
console.log(`Fandt ${files.length} PCS-filer i ${dir}`);

let stagesCount = 0;
let resultsCount = 0;

for (const file of files) {
  const raw = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
  // GUARD: only race files (stage-results or stages-overview) belong here. Rider
  // season files (fixtures/riders/) have `rider`/no `race` and must not be
  // mis-ingested as a race.
  if (!raw.race) { console.log(`  skip (ikke en race-fil): ${file}`); continue; }
  const raceId = `${raw.race.slug}-${raw.race.year}`;

  await db.from('races').upsert({
    id: raceId, name: raw.race.name ?? raw.race.slug, year: raw.race.year,
  });

  if (Array.isArray(raw.stages)) {
    // stages-overview file: upsert features + classified profile for each stage
    for (const s of raw.stages) {
      const profile = classifyStage({
        distanceKm: s.distanceKm ?? 0,
        verticalM: s.verticalM ?? 0,
        profileScore: s.profileScore ?? undefined,
        parcoursType: s.parcoursType ?? undefined,
        discipline: s.discipline ?? 'road',
      });
      await db.from('race_stages').upsert({
        id: `${raceId}-stage-${s.stageNo}`,
        race_id: raceId, stage_no: s.stageNo, date: s.date ?? null,
        distance_km: s.distanceKm ?? null, vertical_m: s.verticalM ?? null,
        profile_score: s.profileScore ?? null, parcours_type: s.parcoursType ?? null,
        discipline: s.discipline ?? 'road', profile,
      });
      stagesCount++;
    }
  } else if (raw.results) {
    // DATA-QUALITY GUARD: skip stages with no usable result (all rank=null) —
    // TTT (misparsed) or neutralised/no-result stages. Detected in data.
    if (!hasUsableResults(raw.results)) {
      console.log(`  skip (no usable result — all rank=null): ${file}`);
      continue;
    }
    // stage-results file
    const { stage, results } = parsePcsExport(raw as PcsExport);
    // ensure the stage row exists (features may be filled later by a stages file)
    await db.from('race_stages').upsert(stage, { onConflict: 'id', ignoreDuplicates: false });
    await db.from('results').upsert(results, { onConflict: 'stage_id,pcs_rider_slug' });
    resultsCount += results.length;
  }
  console.log(`  ok: ${file}`);
}

console.log(`Færdig. ${stagesCount} etape-features, ${resultsCount} resultatrækker.`);
console.log('Note: rytter-linking (pcs_rider_slug -> holdet rider_id) sker separat,');
console.log('når Tour-spillets ryttere er hentet ind via holdet-snippet.');
