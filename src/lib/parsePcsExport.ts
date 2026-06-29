// src/lib/parsePcsExport.ts
// Normalizes the JSON produced by the PCS browser snippets into DB-ready rows
// (races / race_stages / results) and classifies the stage profile on the way
// in. Transport-agnostic: it does not care HOW the JSON was obtained.

import {
  classifyStage,
  type StageFeatures,
  type ParcoursType,
  type Discipline,
} from './stageProfile';

export interface PcsExport {
  race: { slug: string; year: number; name?: string };
  stage: {
    stageNo: number | null;            // 0 = prologue, null = one-day race
    date?: string | null;
    distanceKm?: number | null;
    verticalM?: number | null;
    profileScore?: number | null;
    parcoursType?: ParcoursType | null;
    discipline?: Discipline | null;
  };
  results: Array<{
    rank: number | null;
    status?: string;                   // OK / DNF / DNS / OTL / DSQ / NR
    riderSlug: string;
    riderName: string;
    team?: string | null;
  }>;
}

export interface RaceRow { id: string; name: string; year: number; }
export interface StageRow {
  id: string; race_id: string; stage_no: number | null; date: string | null;
  distance_km: number | null; vertical_m: number | null; profile_score: number | null;
  parcours_type: string | null; discipline: string; profile: string;
}
export interface ResultRow {
  stage_id: string; pcs_rider_slug: string; rider_name: string;
  rank: number | null; status: string;
}

/**
 * Data-quality guard: a stage is usable for calibration/backtest only if at
 * least ONE rider has a real finishing rank. All-null stages are either a TTT
 * (the snippet misparses team time trials -> rank=null, name+gap in `status`) or
 * a neutralised / no-result stage (e.g. Vuelta 2025 stage 21 Madrid). Detected
 * in the DATA, not by filename, so future neutralised stages are caught too.
 */
export function hasUsableResults(results: Array<{ rank: number | null }>): boolean {
  return results.some((r) => r.rank != null);
}

export function parsePcsExport(x: PcsExport): {
  race: RaceRow; stage: StageRow; results: ResultRow[];
} {
  const raceId = `${x.race.slug}-${x.race.year}`;
  const stageId = x.stage.stageNo == null ? raceId : `${raceId}-stage-${x.stage.stageNo}`;

  const feat: StageFeatures = {
    distanceKm: x.stage.distanceKm ?? 0,
    verticalM: x.stage.verticalM ?? 0,
    profileScore: x.stage.profileScore ?? undefined,
    parcoursType: x.stage.parcoursType ?? undefined,
    discipline: x.stage.discipline ?? 'road',
  };
  const profile = classifyStage(feat);

  return {
    race: { id: raceId, name: x.race.name ?? x.race.slug, year: x.race.year },
    stage: {
      id: stageId,
      race_id: raceId,
      stage_no: x.stage.stageNo ?? null,
      date: x.stage.date ?? null,
      distance_km: x.stage.distanceKm ?? null,
      vertical_m: x.stage.verticalM ?? null,
      profile_score: x.stage.profileScore ?? null,
      parcours_type: x.stage.parcoursType ?? null,
      discipline: feat.discipline ?? 'road',
      profile,
    },
    results: x.results.map((r) => ({
      stage_id: stageId,
      pcs_rider_slug: r.riderSlug,
      rider_name: r.riderName,
      rank: r.rank,
      status: r.status ?? (r.rank == null ? 'NR' : 'OK'),
    })),
  };
}
