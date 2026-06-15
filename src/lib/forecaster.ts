// src/lib/forecaster.ts
// TRIN 5a — placement forecaster. For a (rider, stage) it produces a probability
// distribution over finishing OUTCOMES and turns that into an expected price
// delta via the empirically-inferred value formula (artifacts/value-formula.json).
//
// expectedDelta = Σ P(outcome)·value(outcome)        [value from the formula]
//
// MODEL (v1, DELIBERATELY SIMPLE + testable):
//   strength = exp((wForm·form + wFit·profileFit + wArch·archMatch) / temperature)
//   finishing order ~ Plackett-Luce(strength), estimated by seeded Monte-Carlo
//   DNF handled as an independent thinning.
//
// ⚠ The model PARAMETERS (weights, temperature, dnf rate) are UNCALIBRATED
//   defaults — they must be calibrated on the TdF 2025 backtest (TRIN 2) before
//   this is wired to real squads. The VALUE coefficients, by contrast, ARE
//   inferred (Dauphiné). This file is interface + mechanics; do not trust the
//   absolute probabilities until calibrated.

import { archetypeWeights, type StageProfile, type ArchetypeWeights } from './stageProfile';

export type StageScale = 'flat' | 'mountain';

/** Value-formula coefficients the forecaster consumes (adapter below maps the
 *  artifact JSON into this shape). */
export interface ValueCoeffs {
  baseline: Record<StageScale, number>;
  premiumRank1: Record<StageScale, number>; // position premium at rank 1
  decayK: number;                            // exp shape: premium = rank1·e^(-k·(rank-1))
  teamBonus: number;
  dnfPenalty: number;                        // positive magnitude, subtracted
}

export interface RiderInput {
  riderId: number;
  teamId: number;
  price: number;
  ownership: number;            // 0..1 (holdet popularity)
  form: number;                 // form()
  profileFit: number;           // profileFit() for THIS profile
  riderType: ArchetypeWeights;  // rider archetype identity, components sum ~1
  dnfProb?: number;             // base abandon prob (defaults to params.defaultDnfProb)
}

export interface ForecastParams {
  wForm: number; wFit: number; wArch: number; temperature: number;
  samples: number; seed: number; defaultDnfProb: number;
}

/** UNCALIBRATED defaults. Calibrate on TdF 2025 (TRIN 2) before trusting. */
export const DEFAULT_PARAMS: ForecastParams = {
  wForm: 1, wFit: 1, wArch: 1.5, temperature: 1, samples: 4000, seed: 42, defaultDnfProb: 0.03,
};

export interface BucketProbs { win: number; podium: number; top10: number; top20: number; field: number; }
export interface RiderForecast {
  riderId: number;
  strength: number;
  pDnf: number;
  buckets: BucketProbs;   // CONDITIONAL on finishing (sums to 1)
  expectedDelta: number;  // kr, incl. dnf and own-win team bonus
}

// representative ranks per outcome bucket (for the value mapping)
const REP_RANK: Record<keyof BucketProbs, number> = { win: 1, podium: 2.5, top10: 7, top20: 15, field: 50 };

// --- value mapping ---------------------------------------------------------
export function valueOfRank(rank: number, scale: StageScale, c: ValueCoeffs): number {
  return c.baseline[scale] + c.premiumRank1[scale] * Math.exp(-c.decayK * (rank - 1));
}

/** Invert the value curve: the finishing rank that yields (at least) targetDelta.
 *  Used by the transfer evaluator to express a break-even as a placement. */
export function rankForValue(targetDelta: number, scale: StageScale, c: ValueCoeffs): number {
  const prem = targetDelta - c.baseline[scale];
  if (prem <= 0) return Infinity;                 // bunch/none reaches it -> impossible by placing
  if (prem >= c.premiumRank1[scale]) return 1;    // needs a win (or better than rank 1)
  return 1 + Math.log(c.premiumRank1[scale] / prem) / c.decayK;
}

export function scaleOf(profile: StageProfile): StageScale {
  return profile === 'mountain' || profile === 'break' ? 'mountain' : 'flat';
}

// --- strength + Monte-Carlo Plackett-Luce ----------------------------------
function dot(a: ArchetypeWeights, b: ArchetypeWeights): number {
  return a.sprinter * b.sprinter + a.puncheur * b.puncheur + a.climber * b.climber + a.gc * b.gc + a.rouleur * b.rouleur;
}

export function deriveStrength(r: RiderInput, profile: StageProfile, p: ForecastParams): number {
  const archMatch = dot(r.riderType, archetypeWeights(profile));
  const lin = p.wForm * r.form + p.wFit * r.profileFit + p.wArch * archMatch;
  return Math.exp(lin / p.temperature);
}

/** Small seeded PRNG (mulberry32) so forecasts are deterministic/testable. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const addBucket = (c: BucketProbs, pos: number) => {
  if (pos === 1) c.win++; else if (pos <= 3) c.podium++; else if (pos <= 10) c.top10++; else c.top20++;
};

/** Estimate per-rider outcome buckets via seeded MC over Plackett-Luce orders.
 *  Only the top 20 positions are sampled; the rest collapse to `field`. */
export function plackettLuceBuckets(strengths: number[], p: ForecastParams): BucketProbs[] {
  const n = strengths.length;
  const TOP = Math.min(20, n);
  const counts: BucketProbs[] = strengths.map(() => ({ win: 0, podium: 0, top10: 0, top20: 0, field: 0 }));
  const rng = mulberry32(p.seed);
  for (let t = 0; t < p.samples; t++) {
    const placed = new Array<boolean>(n).fill(false);
    let total = strengths.reduce((a, b) => a + b, 0);
    for (let pos = 1; pos <= TOP; pos++) {
      let r = rng() * total;
      let chosen = -1;
      for (let k = 0; k < n; k++) {
        if (placed[k]) continue;
        r -= strengths[k];
        if (r <= 0) { chosen = k; break; }
      }
      if (chosen < 0) for (let k = 0; k < n; k++) if (!placed[k]) { chosen = k; break; }
      placed[chosen] = true; total -= strengths[chosen];
      addBucket(counts[chosen], pos);
    }
    for (let k = 0; k < n; k++) if (!placed[k]) counts[k].field++;
  }
  return counts.map((c) => ({
    win: c.win / p.samples, podium: c.podium / p.samples, top10: c.top10 / p.samples,
    top20: c.top20 / p.samples, field: c.field / p.samples,
  }));
}

export function expectedDeltaFor(
  buckets: BucketProbs, pDnf: number, scale: StageScale, c: ValueCoeffs, teammateWinProb = 0,
): number {
  const v = (rank: number) => valueOfRank(rank, scale, c);
  const finishVal =
    buckets.win * (v(1) + c.teamBonus) +     // own win triggers team bonus too
    buckets.podium * v(REP_RANK.podium) +
    buckets.top10 * v(REP_RANK.top10) +
    buckets.top20 * v(REP_RANK.top20) +
    buckets.field * v(REP_RANK.field);
  // a teammate (not self) winning still pays the +60k team bonus (stacking)
  const stackBonus = (1 - buckets.win) * teammateWinProb * c.teamBonus;
  return (1 - pDnf) * (finishVal + stackBonus) + pDnf * (-c.dnfPenalty);
}

export interface ForecastOptions { teammateWinProb?: Map<number, number>; }

/** Forecast a whole field on one stage. */
export function forecastStage(
  riders: RiderInput[], profile: StageProfile, coeffs: ValueCoeffs,
  params: ForecastParams = DEFAULT_PARAMS, opts: ForecastOptions = {},
): RiderForecast[] {
  const scale = scaleOf(profile);
  const strengths = riders.map((r) => deriveStrength(r, profile, params));
  const buckets = plackettLuceBuckets(strengths, params);
  return riders.map((r, i) => {
    const pDnf = r.dnfProb ?? params.defaultDnfProb;
    const twp = opts.teammateWinProb?.get(r.riderId) ?? 0;
    return {
      riderId: r.riderId, strength: strengths[i], pDnf, buckets: buckets[i],
      expectedDelta: expectedDeltaFor(buckets[i], pDnf, scale, coeffs, twp),
    };
  });
}

/** Adapt artifacts/value-formula.json into ValueCoeffs. */
export function coeffsFromArtifact(json: any): ValueCoeffs {
  const cp = json.components ?? json;
  return {
    baseline: { flat: cp.baseline.flatStages, mountain: cp.baseline.mountainStages },
    premiumRank1: { flat: cp.positionPremium.byRank['1'].flat, mountain: cp.positionPremium.byRank['1'].mountain },
    decayK: cp.positionPremium.shape?.param ?? 0.108,
    teamBonus: cp.teamBonus.value,
    dnfPenalty: Math.abs(cp.dnfPenalty.value),
  };
}
