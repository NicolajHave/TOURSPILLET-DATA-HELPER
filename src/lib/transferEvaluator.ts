// src/lib/transferEvaluator.ts
// TRIN 5b/5c/5d — evaluate a candidate transfer (sell X, buy Y) over a horizon
// H ∈ {1..N stages}, accounting for the 1% buy fee, expected unwind fee, and
// 0.5%/round interest on freed cash; discount later stages for rising forecast
// uncertainty; overlay tournament leverage (under-ownership); and express the
// result as a BREAK-EVEN PLACEMENT, not just a number.
//
//   NetGain(H) = Σ_{i=1..H} decay^(i-1)·(E[Δ_Y(i)] − E[Δ_X(i)])
//                − buyFee(Y) − expectedUnwindFee + interestAdj(H)
//
// ⚠ The expected per-stage deltas come from the forecaster, whose MODEL params
//   are uncalibrated (TRIN 2). Treat outputs as mechanics, not advice, until the
//   backtest sanity-check passes.

import { buyFee, DAUPHINE_2026, type Ruleset } from './ruleset';
import { rankForValue, type StageScale, type ValueCoeffs } from './forecaster';

export interface TransferLeg {
  stage: number;
  expectedDeltaX: number;   // E[Δ] if you KEEP X this stage
  expectedDeltaY: number;   // E[Δ] if you hold Y this stage
  scale: StageScale;
}

export interface TransferInput {
  legs: TransferLeg[];          // ordered; index 0 = next stage
  buyPriceY: number;
  priceX: number;
  ownershipX: number;           // 0..1
  ownershipY: number;           // 0..1
  unwindProb?: number;          // prob Y is sold before horizon end (default 0)
  confidenceDecay?: number;     // c in (0,1]; later stages weighted c^(i-1) (default 0.85)
  lowConfidence?: number;       // flag threshold on per-horizon confidence (default 0.6)
  ruleset?: Ruleset;
  coeffs: ValueCoeffs;          // for break-even placement inversion
}

export interface BreakEven {
  requiredAvgDeltaY: number;    // kr/stage Y must average to break even at this H
  requiredRank: number;         // finishing rank that yields that delta (Infinity = unreachable by placing)
  note: string;
}
export interface HorizonResult {
  H: number;
  netGain: number;
  leverageAdjusted: number;     // tournament view (weighted by under-ownership)
  confidence: number;           // 0..1, decays with H
  flagged: boolean;             // confidence below threshold -> treat as noise
  breakEven: BreakEven;
}
export interface TransferEvaluation { perHorizon: HorizonResult[]; best: HorizonResult; }

function describeRank(rank: number): string {
  if (!isFinite(rank)) return 'uopnåeligt ved placering alene (kræver trøje/holdbonus eller billigere indgang)';
  if (rank <= 1) return 'etapesejr (plads 1) eller bedre';
  if (rank <= 3) return `podie (≈ plads ${rank.toFixed(1)})`;
  if (rank <= 10) return `top-10 (≈ plads ${rank.toFixed(1)})`;
  if (rank <= 25) return `≈ plads ${rank.toFixed(0)}`;
  return `kun en menig placering (≈ plads ${rank.toFixed(0)}) — let opnåeligt`;
}

export function evaluateTransfer(input: TransferInput): TransferEvaluation {
  const rs = input.ruleset ?? DAUPHINE_2026;
  const decay = input.confidenceDecay ?? 0.85;
  const lowConf = input.lowConfidence ?? 0.6;
  const unwindProb = input.unwindProb ?? 0;
  const freedCash = input.priceX - input.buyPriceY; // >0 frees cash, <0 needs cash
  const oneOffFee = buyFee(input.buyPriceY, rs);
  const unwindFee = unwindProb * rs.transferFee * input.buyPriceY;

  const perHorizon: HorizonResult[] = [];
  let grossDisc = 0;
  let sumDisc = 0;
  let keepDisc = 0; // discounted Σ E[Δ_X] (the bar to beat)
  let levGross = 0;

  for (let i = 0; i < input.legs.length; i++) {
    const w = Math.pow(decay, i);
    const leg = input.legs[i];
    grossDisc += w * (leg.expectedDeltaY - leg.expectedDeltaX);
    keepDisc += w * leg.expectedDeltaX;
    sumDisc += w;
    levGross += w * (leg.expectedDeltaY * (1 - input.ownershipY) - leg.expectedDeltaX * (1 - input.ownershipX));

    const H = i + 1;
    const interestAdj = freedCash * rs.interestRate * H;
    const costs = oneOffFee + unwindFee;
    const netGain = grossDisc - costs + interestAdj;
    const leverageAdjusted = levGross - costs + interestAdj;
    const confidence = Math.pow(decay, i); // confidence in the furthest stage included

    // break-even: average per-stage E[Δ_Y] needed so netGain >= 0
    const requiredTotalY = costs - interestAdj + keepDisc;
    const requiredAvgDeltaY = requiredTotalY / sumDisc;
    const scale = input.legs[0].scale; // express vs the next stage's value curve
    const requiredRank = rankForValue(requiredAvgDeltaY, scale, input.coeffs);

    perHorizon.push({
      H, netGain, leverageAdjusted, confidence, flagged: confidence < lowConf,
      breakEven: {
        requiredAvgDeltaY, requiredRank,
        note: `Køb Y er positivt over ${H} etape(r) hvis Y i snit leverer ${describeRank(requiredRank)} pr. etape.`,
      },
    });
  }

  // "best" = highest netGain among NON-flagged horizons; fall back to H=1.
  const eligible = perHorizon.filter((h) => !h.flagged);
  const best = (eligible.length ? eligible : perHorizon).reduce((a, b) => (b.netGain > a.netGain ? b : a));
  return { perHorizon, best };
}

// --- constraints (5d) ------------------------------------------------------
export interface SquadMember { riderId: number; teamId: number; price: number; }
export interface ConstraintCheck {
  ok: boolean;
  squadSizeOk: boolean;
  perTeamOk: boolean;
  salaryCapOk: boolean;
  totalPrice: number;
  violations: string[];
}

/** Validate a proposed squad against ruleset constraints (greedy per-slot
 *  evaluation calls this after each candidate swap). */
export function checkConstraints(squad: SquadMember[], rs: Ruleset = DAUPHINE_2026): ConstraintCheck {
  const violations: string[] = [];
  const squadSizeOk = squad.length === rs.squadSize;
  if (!squadSizeOk) violations.push(`squad har ${squad.length} ryttere, kræver ${rs.squadSize}`);

  const perTeam = new Map<number, number>();
  for (const m of squad) perTeam.set(m.teamId, (perTeam.get(m.teamId) ?? 0) + 1);
  const overTeams = [...perTeam.entries()].filter(([, n]) => n > rs.maxPerRealTeam);
  const perTeamOk = overTeams.length === 0;
  for (const [teamId, n] of overTeams) violations.push(`hold ${teamId}: ${n} ryttere > max ${rs.maxPerRealTeam}`);

  const totalPrice = squad.reduce((s, m) => s + m.price, 0);
  const salaryCapOk = totalPrice <= rs.salaryCap;
  if (!salaryCapOk) violations.push(`samlet pris ${totalPrice} > cap ${rs.salaryCap}`);

  return { ok: squadSizeOk && perTeamOk && salaryCapOk, squadSizeOk, perTeamOk, salaryCapOk, totalPrice, violations };
}

/** Apply a swap (sell X, buy Y) to a squad and return the new squad. */
export function applySwap(squad: SquadMember[], sellRiderId: number, buy: SquadMember): SquadMember[] {
  return [...squad.filter((m) => m.riderId !== sellRiderId), buy];
}
