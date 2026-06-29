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

/** No-lookahead EV strength for one rider on one stage profile. */
export function evStrength(history: Result[], asOf: Date, profile: StageProfile, beta = EV_BETA): number {
  return form(history, asOf) + beta * profileFit(history, profile, asOf);
}
