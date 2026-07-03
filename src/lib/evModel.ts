// src/lib/evModel.ts
// The calibrated EV ranking signal. strength = form + β·profileFit, with β
// calibrated on TdF 2025 (recall@15 of actual top-10) and validated on the
// Vuelta 2025 holdout. The optimum is profileFit-dominant — generic form mainly
// serves as a cold-start fallback for riders with no profile history.
// See docs/EV_MODEL.md. Re-run `npm run calibrate:ev` to refit β.

import { form, profileFit, type Result } from './form';
import type { StageProfile } from './stageProfile';

/** Calibrated profileFit weight (TdF 2025; profileFit-dominant). */
export const EV_BETA = 20;

/** Win-probability sharpening: P(rider wins) ∝ strength^γ. Calibrated by max
 *  log-likelihood of actual stage winners (npm run calibrate:winprob): γ=2 best
 *  on TdF+Vuelta 2025 fit (38 stages), γ=1 slightly better on the small 2026
 *  holdout (12) → γ=1.5 as the honest pooled compromise. Feeds the forward-
 *  looking team bonus: expectedTeamBonus = P(team wins)·60k (HANDOVER §2.3).
 *  Bruges også som team-niveau-γ for TTT (entiteter = ~23 hold, ikke 176
 *  ryttere — koncentrationen er en anden end per-rytter). */
export const WIN_PROB_GAMMA = 1.5;

/** PER-PROFIL γ (samme MLE, splittet på etapeprofil — fit+holdout samlet,
 *  50 etaper). Favoritter dominerer bjerg/punch (γ=2.5, P(favorit)≈18-19%);
 *  break er et lotteri (γ=1, P(favorit)≈3%); sprint midt imellem (γ=1.5).
 *  itt er tynd (n=4) → poolet γ=2. Poolet γ udglattede det her væk og
 *  undervurderede favoritter på præcis de etaper hvor værdien ligger.
 *  ttt = team-niveau → WIN_PROB_GAMMA. */
export const WIN_PROB_GAMMA_BY_PROFILE: Record<StageProfile, number> = {
  break: 1, itt: 2, mountain: 2.5, punch: 2.5, sprint: 1.5, ttt: WIN_PROB_GAMMA,
};

/** Empirisk DNF/DNS-hazard pr. rytter pr. etape (npm run calibrate:dnf; 51
 *  etaper TdF+Vuelta 2025 + Dauphiné/Suisse 2026, 8194 startere, 159 events).
 *  Bjerg skiller sig markant ud (3,4 % — tidsgrænse + nedkørsler); resten
 *  <1,2 %. Forecasterens flade 3 %-default var for høj overalt UNDTAGEN bjerg.
 *  ttt: ingen events i data → itt-raten (nærmeste analog). */
export const DNF_RATE_BY_PROFILE: Record<StageProfile, number> = {
  break: 0.0113, itt: 0.008, mountain: 0.0343, punch: 0.0078, sprint: 0.0087, ttt: 0.008,
};
export const DNF_RATE_POOLED = 0.0194;

/** No-lookahead EV strength for one rider on one stage profile. */
export function evStrength(history: Result[], asOf: Date, profile: StageProfile, beta = EV_BETA): number {
  return form(history, asOf) + beta * profileFit(history, profile, asOf);
}
