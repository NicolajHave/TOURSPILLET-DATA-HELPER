// src/lib/stageProfile.ts
// Classifies a stage into a scoring archetype. Transport-independent: it takes
// normalized StageFeatures (from PCS stage pages or manual entry) and decides
// WHICH RIDER TYPE tends to gain holdet value on that profile. This is the link
// between "tomorrow's terrain" and "who to captain / buy".

export type ParcoursType =
  | 'flat'
  | 'hilly_flat_finish'
  | 'hilly_uphill_finish'
  | 'mountain_flat_finish'
  | 'mountain_summit_finish';

export type Discipline = 'road' | 'itt' | 'ttt';

export type StageProfile =
  | 'sprint'    // flat bunch sprint
  | 'punch'     // short steep / uphill finish, reduced bunch
  | 'break'     // medium/high mountain WITHOUT summit finish — breakaway day
  | 'mountain'  // high mountain summit finish — GC + climbers
  | 'itt'       // individual time trial
  | 'ttt';      // team time trial

export interface StageFeatures {
  distanceKm: number;
  verticalM: number;
  profileScore?: number;        // PCS ProfileScore, if scraped
  parcoursType?: ParcoursType;  // PCS parcours icon, if scraped
  summitFinish?: boolean;
  discipline?: Discipline;      // defaults to 'road'
}

/** Which rider archetype scores on a given profile. Sums to ~1. */
export interface ArchetypeWeights {
  sprinter: number;
  puncheur: number;
  climber: number;
  gc: number;
  rouleur: number; // TT engines / breakaway rouleurs
}

const WEIGHTS: Record<StageProfile, ArchetypeWeights> = {
  sprint:   { sprinter: 0.70, puncheur: 0.15, climber: 0.00, gc: 0.05, rouleur: 0.10 },
  punch:    { sprinter: 0.15, puncheur: 0.55, climber: 0.10, gc: 0.15, rouleur: 0.05 },
  break:    { sprinter: 0.05, puncheur: 0.25, climber: 0.35, gc: 0.10, rouleur: 0.25 },
  mountain: { sprinter: 0.00, puncheur: 0.05, climber: 0.45, gc: 0.45, rouleur: 0.05 },
  itt:      { sprinter: 0.05, puncheur: 0.05, climber: 0.10, gc: 0.40, rouleur: 0.40 },
  ttt:      { sprinter: 0.10, puncheur: 0.10, climber: 0.10, gc: 0.35, rouleur: 0.35 },
};

export function archetypeWeights(profile: StageProfile): ArchetypeWeights {
  return WEIGHTS[profile];
}

/**
 * Classify a stage. Prefers PCS's own parcours type when present, falls back to
 * ProfileScore / vertical-metre heuristics. Returns the scoring profile.
 */
export function classifyStage(f: StageFeatures): StageProfile {
  const discipline = f.discipline ?? 'road';
  if (discipline === 'ttt') return 'ttt';
  if (discipline === 'itt') return 'itt';

  // Summit finish always dominates.
  if (f.summitFinish || f.parcoursType === 'mountain_summit_finish') return 'mountain';

  switch (f.parcoursType) {
    case 'mountain_flat_finish':
      return 'break';            // big climbing, valley/descent finish -> breakaway
    case 'hilly_uphill_finish':
      return 'punch';
    case 'hilly_flat_finish':
      return f.verticalM >= 2500 ? 'break' : 'sprint';
    case 'flat':
      return 'sprint';
  }

  // No parcours icon: fall back to ProfileScore (PCS scale) then vertical metres.
  const ps = f.profileScore;
  if (ps !== undefined) {
    if (ps >= 100) return 'mountain';
    if (ps >= 50) return 'break';
    if (ps >= 20) return 'punch';
    return 'sprint';
  }
  const climbDensity = f.verticalM / Math.max(f.distanceKm, 1); // m per km
  if (climbDensity >= 20) return 'mountain';
  if (climbDensity >= 12) return 'break';
  if (climbDensity >= 7) return 'punch';
  return 'sprint';
}
