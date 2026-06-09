// src/lib/ruleset.ts
// Holdet.dk "Cycling Trading 8 Riders" ruleset.
// Values pulled directly from GET /api/cartridges/{slug} -> _embedded.rulesets.117
// (transferFee 0.01, interestRate 0.005, salaryCap 50_000_000,
//  captainBonusAssets 1, captainBonusPoints 0).
// Re-confirm against the live Tour de France 2026 cartridge before the race —
// holdet ships a new ruleset id each season and a value could change.

export interface Ruleset {
  salaryCap: number;          // total squad budget
  transferFee: number;        // fraction charged on the PRICE of a rider you buy
  interestRate: number;       // fraction credited on idle bank balance per round
  captainBonusAssets: number; // how many riders the captain bonus applies to
  squadSize: number;          // riders on a team
  maxPerRealTeam: number;     // max riders from the same real cycling team
}

export const DAUPHINE_2026: Ruleset = {
  salaryCap: 50_000_000,
  transferFee: 0.01,
  interestRate: 0.005,
  captainBonusAssets: 1,
  squadSize: 8,
  maxPerRealTeam: 2,
};

/** Fee paid when buying a rider — charged on the bought rider's current price. */
export function buyFee(price: number, rs: Ruleset = DAUPHINE_2026): number {
  return Math.round(price * rs.transferFee);
}

/** Raw value change from holding a rider across one round (no trade). */
export function holdDelta(priceBefore: number, priceAfter: number): number {
  return priceAfter - priceBefore;
}

/**
 * Net value change from BUYING a rider this round and holding to the next
 * snapshot. Subtracts the buy fee. Use to decide whether a one-round trade
 * clears its own cost.
 */
export function buyAndHoldNet(
  priceBefore: number,
  priceAfter: number,
  rs: Ruleset = DAUPHINE_2026,
): number {
  return priceAfter - priceBefore - buyFee(priceBefore, rs);
}

/**
 * Minimum value rise (as a fraction of price) a one-round buy must clear just
 * to break even on the fee. Equals the transfer fee, i.e. the rider must rise
 * by MORE than transferFee to be worth a single-stage punt.
 */
export function breakEvenRise(rs: Ruleset = DAUPHINE_2026): number {
  return rs.transferFee;
}

/**
 * Captain bonus. The positive value rise of the captained rider is paid to the
 * bank at round close (captainBonusAssets = 1, captainBonusPoints = 0), which
 * effectively doubles the captain's positive value delta. Only the positive
 * part counts. Confirm exact behaviour against live data once the race runs.
 */
export function captainBonus(valueDelta: number): number {
  return Math.max(0, valueDelta);
}

/** Interest credited on an idle bank balance at round close. */
export function interest(bank: number, rs: Ruleset = DAUPHINE_2026): number {
  return Math.round(bank * rs.interestRate);
}

export interface LeverageInput {
  /** Predicted (live) or realized (backtest) value change in kr. */
  expectedDelta: number;
  /** Ownership as a fraction 0..1 (holdet `popularity`). */
  popularity: number;
}

/**
 * Tournament leverage score for "beat the entire field" play.
 *
 * Plain expected-value maximisation converges on the chalk (the riders
 * everyone owns), so it cannot win an absolute ranking. This rewards expected
 * value gain AND differentiation: a rider that rises while few own him moves
 * you UP the field; a rider that rises while everyone owns him moves the whole
 * field together and gains you nothing relative.
 *
 *   leverage = expectedDelta * (1 - popularity)
 *
 * For cash-game / mini-league play you would instead maximise expectedDelta
 * directly. This tool targets absolute rank, so leverage is the default.
 */
export function leverageScore({ expectedDelta, popularity }: LeverageInput): number {
  return expectedDelta * (1 - popularity);
}
