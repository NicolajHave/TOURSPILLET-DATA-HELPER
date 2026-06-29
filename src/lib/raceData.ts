// src/lib/raceData.ts
// Shared loader: turn a race's PCS stage files into classified, dated stage
// records (used by calibrateEV + backtestCaptain so they agree exactly).
// Applies the no-usable-result guard (skips all-null TTT/neutralised stages).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyStage, type StageProfile, type StageFeatures } from './stageProfile';
import { hasUsableResults } from './parsePcsExport';

export interface StageFinisher { slug: string; rank: number; team: string | null; }
export interface StageRec {
  race: string;
  stageNo: number;
  date: string;             // ISO
  profile: StageProfile;
  winnerTeam: string | null;
  finishers: StageFinisher[];
}

/**
 * @param preferProfileScore use the absolute PCS profileScore from the result
 *        file (objective, cross-race) instead of the parcours icon. Use for
 *        races whose result files carry profileScore (e.g. Vuelta v3 scrape).
 */
export function loadRace(
  pcsDir: string, race: string, slug: string, year: number, preferProfileScore: boolean,
): StageRec[] {
  const stagesFile = JSON.parse(readFileSync(join(pcsDir, `${slug}-${year}-stages.json`), 'utf8'));
  const sMeta = new Map<number, any>();
  for (const s of stagesFile.stages) sMeta.set(s.stageNo, s);

  const out: StageRec[] = [];
  for (let n = 0; n <= 21; n++) {
    let raw: any;
    try { raw = JSON.parse(readFileSync(join(pcsDir, `${slug}-${year}-stage-${n}.json`), 'utf8')); } catch { continue; }
    if (!hasUsableResults(raw.results)) continue; // guard: TTT / neutralised
    const sm = sMeta.get(n) ?? {};
    const [dd, mm] = (sm.date ?? '').split('/');
    const date = dd && mm ? `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}` : `${year}-07-01`;
    const ps = raw.stage?.profileScore ?? null;
    const feat: StageFeatures = preferProfileScore && ps != null
      ? { distanceKm: raw.stage?.distanceKm ?? 0, verticalM: raw.stage?.verticalM ?? 0, profileScore: ps, discipline: sm.discipline ?? 'road' }
      : { distanceKm: 0, verticalM: sm.verticalM ?? 0, profileScore: sm.profileScore ?? undefined, parcoursType: sm.parcoursType ?? undefined, summitFinish: sm.summitFinish ?? undefined, discipline: sm.discipline ?? 'road' };
    const finishers: StageFinisher[] = raw.results
      .filter((x: any) => x.rank != null)
      .map((x: any) => ({ slug: x.riderSlug, rank: x.rank, team: x.team ?? null }));
    const winnerTeam = (finishers.find((x) => x.rank === 1) || {}).team ?? null;
    out.push({ race, stageNo: n, date, profile: classifyStage(feat), winnerTeam, finishers });
  }
  return out;
}
