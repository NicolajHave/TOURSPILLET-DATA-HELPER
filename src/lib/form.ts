// src/lib/form.ts
// Computes rider FORM and PROFILE-FIT from historical results. Pure logic — feed
// it a Result[] (from PCS, however transported) and it returns the features the
// expectedDelta model consumes. No network, no DB dependency.

import type { StageProfile } from './stageProfile';

export interface Result {
  riderId: number;          // holdet rider id (after PCS->holdet name linking)
  date: string;             // ISO date of the stage
  profile: StageProfile;    // classified profile of that stage
  rank: number | null;      // finishing rank; null if DNF/DNS/OTL
  finished: boolean;
}

/**
 * Recency-weighted form. Recent results count far more than old ones — the
 * Critérium du Dauphiné days before the Tour outweighs a March result. Weight
 * decays exponentially with age; a strong placing scores higher than a weak one.
 *
 * @param halfLifeDays  days after which a result's weight halves (default 30)
 */
export function form(
  results: Result[],
  asOf: Date,
  halfLifeDays = 30,
): number {
  const lambda = Math.LN2 / halfLifeDays;
  let score = 0;
  for (const r of results) {
    if (!r.finished || r.rank == null) continue;
    const ageDays = (asOf.getTime() - new Date(r.date).getTime()) / 86_400_000;
    if (ageDays < 0) continue; // ignore future (no lookahead — critical for backtest)
    const recency = Math.exp(-lambda * ageDays);
    const quality = placingScore(r.rank);
    score += recency * quality;
  }
  return +score.toFixed(3);
}

/** Diminishing points for finishing position — top places worth far more. */
export function placingScore(rank: number): number {
  if (rank <= 0) return 0;
  return 1 / Math.sqrt(rank); // 1st=1.00, 4th=0.50, 16th=0.25
}

/**
 * Profile-fit: recency-weighted average placing score on a SPECIFIC profile.
 * "How well does this rider do on mountain summit finishes, lately?"
 *
 * SHRINKAGE (priorWeight): et rent vægtet gennemsnit gør n=1 katastrofal —
 * recency-vægten forkorter sig selv væk, så én enkelt gammel sejr giver
 * fit = 1,0 (maksimum!) uanset alder. Casen der afslørede det: Lipowitz'
 * eneste sprint-klassificerede 2026-resultat var en januar-endagssejr →
 * fit_sprint 1,0 → han toppede alle sprintetaper foran ægte sprintere med
 * 10+ resultater. Fantom-observationen (kvalitet 0, fuld vægt) i nævneren
 * skrumper tynde profiler mod 0 og genindfører alders-effekten for n=1,
 * mens ryttere med mange resultater næsten ikke påvirkes.
 */
export function profileFit(
  results: Result[],
  profile: StageProfile,
  asOf: Date,
  halfLifeDays = 120, // profile aptitude is more stable than form -> longer memory
  priorWeight = 1,
): number {
  const lambda = Math.LN2 / halfLifeDays;
  let num = 0;
  let den = 0;
  for (const r of results) {
    if (r.profile !== profile) continue;
    const ageDays = (asOf.getTime() - new Date(r.date).getTime()) / 86_400_000;
    if (ageDays < 0) continue;
    const w = Math.exp(-lambda * ageDays);
    num += w * (r.finished && r.rank != null ? placingScore(r.rank) : 0);
    den += w;
  }
  return den === 0 ? 0 : +(num / (den + priorWeight)).toFixed(3);
}
