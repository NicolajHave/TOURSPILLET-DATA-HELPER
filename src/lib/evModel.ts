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
 *  holdout (12) → γ=1.5 as the honest compromise. Feeds the forward-looking
 *  team bonus: expectedTeamBonus = P(team wins)·60k (stacking, HANDOVER §2.3). */
export const WIN_PROB_GAMMA = 1.5;

/** No-lookahead EV strength for one rider on one stage profile. */
export function evStrength(history: Result[], asOf: Date, profile: StageProfile, beta = EV_BETA): number {
  return form(history, asOf) + beta * profileFit(history, profile, asOf);
}
