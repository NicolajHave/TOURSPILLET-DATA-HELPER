// scripts/proveForecaster.ts
// TRIN 5 — synthetic unit tests for the forecaster + transfer evaluator.
// Verifies MECHANICS (monotonicity, normalization, fee/interest/leverage/
// break-even/constraints), NOT calibration accuracy. No real data, no network.
//   npx tsx scripts/proveForecaster.ts
import {
  forecastStage, expectedDeltaFor, valueOfRank, rankForValue, deriveStrength,
  DEFAULT_PARAMS, type ValueCoeffs, type RiderInput, type BucketProbs,
} from '../src/lib/forecaster';
import { evaluateTransfer, checkConstraints, type TransferLeg } from '../src/lib/transferEvaluator';
import { leverageScore } from '../src/lib/ruleset';
import { archetypeWeights, type ArchetypeWeights } from '../src/lib/stageProfile';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}  ${extra}`); }
};
const approx = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

// synthetic value coefficients (shape of artifacts/value-formula.json)
const C: ValueCoeffs = {
  baseline: { flat: 0, mountain: -67500 },
  premiumRank1: { flat: 281000, mountain: 466000 },
  decayK: 0.108, teamBonus: 60000, dnfPenalty: 100000,
};

const type = (o: Partial<ArchetypeWeights>): ArchetypeWeights =>
  ({ sprinter: 0, puncheur: 0, climber: 0, gc: 0, rouleur: 0, ...o });

console.log('── VALUE MAPPING ───────────────────────────────────────────────');
ok('valueOfRank monotone decreasing', valueOfRank(1, 'flat', C) > valueOfRank(5, 'flat', C) && valueOfRank(5, 'flat', C) > valueOfRank(20, 'flat', C));
ok('flat bunch finish ≈ 0', approx(valueOfRank(50, 'flat', C), 0, 5000));
ok('mountain bunch finish < 0 (gruppetto loses value)', valueOfRank(50, 'mountain', C) < -50000);
ok('mountain win > flat win (scale)', valueOfRank(1, 'mountain', C) > valueOfRank(1, 'flat', C));
ok('rankForValue inverts valueOfRank', approx(rankForValue(valueOfRank(7, 'flat', C), 'flat', C), 7, 0.01), `got ${rankForValue(valueOfRank(7, 'flat', C), 'flat', C)}`);
ok('rankForValue: bunch-level target unreachable by placing', !isFinite(rankForValue(valueOfRank(60, 'flat', C), 'flat', C)) || rankForValue(0, 'flat', C) === Infinity);

console.log('\n── expectedDelta ───────────────────────────────────────────────');
const winBucket: BucketProbs = { win: 1, podium: 0, top10: 0, top20: 0, field: 0 };
const edWinNoDnf = expectedDeltaFor(winBucket, 0, 'flat', C);
ok('certain win (no dnf) = value(1)+teamBonus', approx(edWinNoDnf, valueOfRank(1, 'flat', C) + C.teamBonus), `got ${edWinNoDnf}`);
const edWinDnf = expectedDeltaFor(winBucket, 0.2, 'flat', C);
ok('higher dnfProb lowers expectedDelta', edWinDnf < edWinNoDnf);
const fieldBucket: BucketProbs = { win: 0, podium: 0, top10: 0, top20: 0, field: 1 };
ok('stacking: teammateWinProb adds value', expectedDeltaFor(fieldBucket, 0, 'mountain', C, 0.5) > expectedDeltaFor(fieldBucket, 0, 'mountain', C, 0));

console.log('\n── FORECASTER (Plackett-Luce MC) ───────────────────────────────');
const profile = 'mountain' as const;
const w = archetypeWeights(profile);
// a clearly strong climber vs a clearly weak sprinter on a mountain stage
const field: RiderInput[] = [
  { riderId: 1, teamId: 10, price: 9_000_000, ownership: 0.5, form: 3.0, profileFit: 0.9, riderType: type({ climber: 0.7, gc: 0.3 }) }, // strong
  { riderId: 2, teamId: 10, price: 3_000_000, ownership: 0.05, form: 0.3, profileFit: 0.1, riderType: type({ sprinter: 0.9, rouleur: 0.1 }) }, // weak on mtn
  { riderId: 3, teamId: 11, price: 6_000_000, ownership: 0.2, form: 1.5, profileFit: 0.5, riderType: type({ gc: 0.6, climber: 0.4 }) },
  { riderId: 4, teamId: 12, price: 4_000_000, ownership: 0.1, form: 1.0, profileFit: 0.4, riderType: type({ puncheur: 0.5, climber: 0.5 }) },
  { riderId: 5, teamId: 13, price: 4_000_000, ownership: 0.1, form: 0.8, profileFit: 0.3, riderType: type({ rouleur: 0.6, gc: 0.4 }) },
];
const fc = forecastStage(field, profile, C);
const strong = fc.find((f) => f.riderId === 1)!;
const weak = fc.find((f) => f.riderId === 2)!;
const bsum = (b: BucketProbs) => b.win + b.podium + b.top10 + b.top20 + b.field;
ok('bucket probs sum to 1 (all riders)', fc.every((f) => approx(bsum(f.buckets), 1, 1e-9)));
ok('stronger climber has higher P(win)', strong.buckets.win > weak.buckets.win, `${strong.buckets.win.toFixed(3)} vs ${weak.buckets.win.toFixed(3)}`);
ok('stronger climber has higher expectedDelta', strong.expectedDelta > weak.expectedDelta);
ok('deriveStrength rewards archetype match', deriveStrength(field[0], profile, DEFAULT_PARAMS) > deriveStrength(field[1], profile, DEFAULT_PARAMS));
ok('determinism: same seed -> same forecast', approx(forecastStage(field, profile, C)[0].buckets.win, strong.buckets.win, 1e-12));

console.log('\n── TRANSFER EVALUATOR ──────────────────────────────────────────');
// Y clearly beats X every stage
const legsYwins: TransferLeg[] = [
  { stage: 1, expectedDeltaX: 0, expectedDeltaY: 200_000, scale: 'mountain' },
  { stage: 2, expectedDeltaX: 0, expectedDeltaY: 200_000, scale: 'mountain' },
  { stage: 3, expectedDeltaX: 0, expectedDeltaY: 200_000, scale: 'mountain' },
];
const evalY = evaluateTransfer({ legs: legsYwins, buyPriceY: 5_000_000, priceX: 5_000_000, ownershipX: 0.5, ownershipY: 0.05, coeffs: C });
ok('dominant Y -> positive netGain at H=1', evalY.perHorizon[0].netGain > 0);
ok('netGain grows with H when Y keeps winning', evalY.perHorizon[2].netGain > evalY.perHorizon[0].netGain);
ok('buy fee is charged (H=1 netGain = grossLeg - buyFee)', approx(evalY.perHorizon[0].netGain, 200_000 - 0.01 * 5_000_000, 1));
ok('confidence decays with H', evalY.perHorizon[0].confidence > evalY.perHorizon[2].confidence);

// equal deltas -> only costs remain (negative, no freed cash)
const legsFlat: TransferLeg[] = [{ stage: 1, expectedDeltaX: 50_000, expectedDeltaY: 50_000, scale: 'flat' }];
const evalFlat = evaluateTransfer({ legs: legsFlat, buyPriceY: 4_000_000, priceX: 4_000_000, ownershipX: 0.3, ownershipY: 0.3, coeffs: C });
ok('equal deltas -> netGain = -buyFee', approx(evalFlat.perHorizon[0].netGain, -0.01 * 4_000_000, 1), `got ${evalFlat.perHorizon[0].netGain}`);
ok('break-even requiredRank is finite & sensible', isFinite(evalFlat.perHorizon[0].breakEven.requiredRank) && evalFlat.perHorizon[0].breakEven.requiredRank >= 1);

// leverage overlay: contrarian Y (low ownership) scores higher than chalk Y, same deltas
const base = { legs: legsYwins, buyPriceY: 5_000_000, priceX: 5_000_000, ownershipX: 0.5, coeffs: C };
const contrarian = evaluateTransfer({ ...base, ownershipY: 0.02 });
const chalk = evaluateTransfer({ ...base, ownershipY: 0.8 });
ok('leverage rewards contrarian Y', contrarian.perHorizon[0].leverageAdjusted > chalk.perHorizon[0].leverageAdjusted);

// freed cash earns interest
const evalFreed = evaluateTransfer({ legs: legsFlat, buyPriceY: 3_000_000, priceX: 5_000_000, ownershipX: 0.3, ownershipY: 0.3, coeffs: C });
ok('freeing cash adds interest vs equal-price swap', evalFreed.perHorizon[0].netGain > evalFlat.perHorizon[0].netGain);

console.log('\n── CONSTRAINTS (5d) ────────────────────────────────────────────');
const mk = (id: number, team: number, price: number) => ({ riderId: id, teamId: team, price });
const valid = [mk(1, 1, 6e6), mk(2, 1, 6e6), mk(3, 2, 6e6), mk(4, 3, 6e6), mk(5, 4, 6e6), mk(6, 5, 6e6), mk(7, 6, 6e6), mk(8, 7, 7e6)];
ok('valid 8-rider squad passes', checkConstraints(valid).ok, JSON.stringify(checkConstraints(valid).violations));
ok('9 riders fails squad size', !checkConstraints([...valid, mk(9, 8, 1e6)]).squadSizeOk);
const threeSameTeam = [mk(1, 1, 6e6), mk(2, 1, 6e6), mk(3, 1, 6e6), mk(4, 3, 6e6), mk(5, 4, 6e6), mk(6, 5, 6e6), mk(7, 6, 6e6), mk(8, 7, 6e6)];
ok('3 from one team fails maxPerRealTeam', !checkConstraints(threeSameTeam).perTeamOk);
const overCap = valid.map((m, i) => (i === 0 ? mk(1, 1, 20e6) : m));
ok('over salary cap fails', !checkConstraints(overCap).salaryCapOk);

console.log('\n── LEVERAGE SCORE (negativ-EV guard) ───────────────────────────');
ok('positiv EV: lav ejerandel > høj ejerandel', leverageScore({ expectedDelta: 100_000, popularity: 0.05 }) > leverageScore({ expectedDelta: 100_000, popularity: 0.8 }));
ok('negativ EV boostes IKKE af lav ejerandel (returnerer -Infinity)', leverageScore({ expectedDelta: -50_000, popularity: 0.02 }) === -Infinity);
ok('sub-EV-gulv pick kan aldrig outranke positiv pick', leverageScore({ expectedDelta: 100_000, popularity: 0.9 }) > leverageScore({ expectedDelta: -1, popularity: 0.0 }));

console.log('\n════════════════════════════════════════════════════════════════');
console.log(`  RESULTAT: ${pass} bestået, ${fail} fejlet`);
if (fail > 0) process.exit(1);
