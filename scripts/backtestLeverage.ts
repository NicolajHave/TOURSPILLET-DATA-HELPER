// scripts/backtestLeverage.ts
// THE core hypothesis test (HANDOVER §2): does differentiating from the chalk by
// ownership move you UP the field, and what does it cost in EV? Dauphiné 2026 is
// the only data with ownership (holdet popularity), so it's the only place to test.
//
// Per round (stages 4-8, the clean ones), we build two squads from a no-lookahead
// EV prediction:
//   • EV-max:    top-8 by predicted EV
//   • Leverage:  top-8 by  EV × (1 − ownership)  among riders above an EV-floor
// We then simulate a FIELD of synthetic managers drawn from the actual ownership,
// score every squad by the REALISED holdet price change, and ask where our two
// squads RANK in the field (percentile) — because the goal is to move up, not to
// bank the most kr.
//
// HONESTY / LIMITS (read before trusting):
//   - One realised Dauphiné outcome (5 rounds = 5 samples). Tournament edge is
//     about expectation over many outcomes; here we see one. Noisy.
//   - Field = independent draw from MARGINAL ownership (ignores lineup correlation).
//   - Predicted EV is a simple no-lookahead proxy (mean prior finishing rank →
//     value curve). The test isolates the LEVERAGE TILT, not prediction quality.
//   - Measures relative field rank on the realised outcome. If leverage does NOT
//     rank higher than EV-max here, that is a real warning about the core strategy.
//
//   npx tsx scripts/backtestLeverage.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  loadHoldetSnapshot, loadPcs, buildRiderIndex, matchRider, mean, median, type HoldetSnapshot,
} from '../src/lib/valueFormula';
import { hasUsableResults } from '../src/lib/parsePcsExport';
import { coeffsFromArtifact, valueOfRank, type StageScale } from '../src/lib/forecaster';
import { DAUPHINE_2026 as RS } from '../src/lib/ruleset';

const f = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const coeffs = coeffsFromArtifact(JSON.parse(readFileSync(f('artifacts/value-formula.json'), 'utf8')));

// ---- params (flagged) -----------------------------------------------------
const FIELD = 4000;          // synthetic managers per round
// EV-floor must be a POSITIVE minimum EV (HANDOVER §2.1). Critically, EV×(1−own)
// only makes sense for EV>0 — for negative EV it INVERTS and rewards high
// ownership. So leverage candidates = riders with EV strictly above this floor.
const EV_FLOOR_KR = 0;
const MIN_POS_CANDS = 8;     // need >=8 positive-EV riders or the round isn't testable
const SEED = 12345;
// EV predictor = value at a SHRUNK expected rank. Raw mean-prior-rank lets a
// single breakaway result dominate (regression-to-mean) and makes "EV-max" pick
// low-owned nobodies — the opposite of chalk. Shrink small samples toward the
// mid-pack so EV-max behaves like the favourites/chalk it is meant to represent.
const SHRINK_M0 = 80;        // mid-pack rank to shrink toward
const SHRINK_K = 4;          // pseudo-count (heavier => more shrink)
const MIN_PRIOR = 2;         // need >=2 prior finishes to be EV-eligible

// ---- load Dauphiné holdet snapshots ---------------------------------------
const snap: Record<number, HoldetSnapshot> = {
  1: loadHoldetSnapshot(f('fixtures/dauphine_players_raw.json')),
};
for (const n of [3, 4, 5, 6, 7, 8]) snap[n] = loadHoldetSnapshot(f(`fixtures/holdet/dauphine-2026-after-stage-${n}.json`));

// stable rider index (roster constant across snapshots) for PCS matching
const idx = buildRiderIndex(snap[3].riders);

// ---- Dauphiné PCS prior finishing ranks per holdet playerId (no-lookahead) -
const pcsHistory: Array<{ stageNo: number; ranks: Map<number, number> }> = [];
for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
  const pcs = loadPcs(f(`fixtures/pcs/dauphine-2026-stage-${n}.json`));
  if (!hasUsableResults(pcs.results)) continue; // skips stage 3 (TTT, all-null)
  const ranks = new Map<number, number>();
  for (const r of pcs.results) {
    if (r.rank == null) continue;
    const m = matchRider(idx, r.riderName, r.riderSlug);
    if (m) ranks.set(m.playerId, r.rank);
  }
  pcsHistory.push({ stageNo: n, ranks });
}

// ---- rounds: scale from the value-formula split (flat 4-5, mountain 6-8) ----
const SCALE: Record<number, StageScale> = { 4: 'flat', 5: 'flat', 6: 'mountain', 7: 'mountain', 8: 'mountain' };

// ---- seeded RNG -----------------------------------------------------------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rng = mulberry32(SEED);

interface Cand { playerId: number; team: number; price: number; own: number; realized: number; ev: number | null; }

function greedySquad(cands: Cand[], score: (c: Cand) => number, pool: Cand[]): Cand[] {
  const sorted = [...pool].sort((a, b) => score(b) - score(a));
  const squad: Cand[] = []; const teamN = new Map<number, number>(); let spend = 0;
  const tryAdd = (c: Cand) => {
    if (squad.length >= RS.squadSize) return false;
    if ((teamN.get(c.team) ?? 0) >= RS.maxPerRealTeam) return false;
    if (spend + c.price > RS.salaryCap) return false;
    squad.push(c); teamN.set(c.team, (teamN.get(c.team) ?? 0) + 1); spend += c.price; return true;
  };
  for (const c of sorted) tryAdd(c);
  if (squad.length < RS.squadSize) { // fill remaining with cheapest feasible
    for (const c of [...cands].sort((a, b) => a.price - b.price)) { if (!squad.includes(c)) tryAdd(c); }
  }
  return squad;
}

function sampleFieldSquad(cands: Cand[]): Cand[] | null {
  const pool = cands.filter((c) => c.own > 0);
  const squad: Cand[] = []; const teamN = new Map<number, number>(); let spend = 0; let tries = 0;
  while (squad.length < RS.squadSize && tries < 400) {
    tries++;
    const avail = pool.filter((c) => !squad.includes(c) && (teamN.get(c.team) ?? 0) < RS.maxPerRealTeam && spend + c.price <= RS.salaryCap);
    if (!avail.length) break;
    let tot = 0; for (const c of avail) tot += c.own;
    let r = rng() * tot; let pick = avail[avail.length - 1];
    for (const c of avail) { r -= c.own; if (r <= 0) { pick = c; break; } }
    squad.push(pick); teamN.set(pick.team, (teamN.get(pick.team) ?? 0) + 1); spend += pick.price;
  }
  return squad.length === RS.squadSize ? squad : null;
}

const sum = (s: Cand[]) => s.reduce((a, c) => a + c.realized, 0);
const ownAvg = (s: Cand[]) => mean(s.map((c) => c.own));
const pct = (val: number, dist: number[]) => dist.filter((v) => v < val).length / dist.length;
const kr = (n: number) => Math.round(n).toLocaleString('da-DK');
const pad = (s: any, n: number) => String(s).padStart(n);

console.log('═'.repeat(80));
console.log('  LEVERAGE-TEST — Dauphiné 2026: EV-max vs leverage-justeret hold (relativ placering)');
console.log('═'.repeat(80));
console.log(`  Felt: ${FIELD} syntetiske managere/runde trukket fra faktiske ejerandele.`);
console.log(`  EV-gulv: kun ryttere med EV>${EV_FLOOR_KR} kr er leverage-kvalificerede (positiv EV påkrævet).`);
console.log('  Percentil = andel af feltet vores hold slår (1.00 = top). Score = REALISERET Δpris.\n');
console.log('   rund scale     EV-max%  lev%   | EV-max kr   lev kr     | ejerandel EV/lev');

const agg = { evPct: [] as number[], levPct: [] as number[], evKr: [] as number[], levKr: [] as number[], evOwn: [] as number[], levOwn: [] as number[], evTop: 0, levTop: 0 };

for (const n of [4, 5, 6, 7, 8]) {
  const before = snap[n === 4 ? 3 : n - 1], after = snap[n];
  const priorByPlayer = new Map<number, number[]>();
  for (const h of pcsHistory) { if (h.stageNo >= n) continue; for (const [pid, rk] of h.ranks) { if (!priorByPlayer.has(pid)) priorByPlayer.set(pid, []); priorByPlayer.get(pid)!.push(rk); } }

  const afterPrice = new Map(after.riders.map((r) => [r.playerId, r.price]));
  const cands: Cand[] = before.riders.filter((r) => !r.isOut && afterPrice.has(r.playerId)).map((r) => {
    const prior = priorByPlayer.get(r.playerId);
    const ev = prior && prior.length >= MIN_PRIOR
      ? valueOfRank((prior.reduce((a, b) => a + b, 0) + SHRINK_K * SHRINK_M0) / (prior.length + SHRINK_K), SCALE[n], coeffs)
      : null;
    return { playerId: r.playerId, team: r.teamId, price: r.price, own: r.popularity, realized: afterPrice.get(r.playerId)! - r.price, ev };
  });

  const predictable = cands.filter((c) => c.ev != null) as Array<Cand & { ev: number }>;
  // EV-floor: leverage candidates = riders with POSITIVE EV above the floor.
  // (EV×(1−own) only makes sense for EV>0.) If too few qualify, the EV model
  // can't differentiate this round -> not testable (cold-start).
  const posEv = predictable.filter((c) => c.ev > EV_FLOOR_KR);
  if (posEv.length < MIN_POS_CANDS) {
    console.log(`   ${pad(n, 3)}  ${SCALE[n].padEnd(8)} IKKE TESTBAR — kun ${posEv.length} ryttere med EV>0 (EV cold-start: kan ikke identificere favoritter)`);
    continue;
  }
  const evSquad = greedySquad(cands, (c) => c.ev ?? -Infinity, predictable);
  const levSquad = greedySquad(cands, (c) => (c.ev ?? -Infinity) * (1 - c.own), posEv);

  const dist: number[] = [];
  for (let i = 0; i < FIELD; i++) { const s = sampleFieldSquad(cands); if (s) dist.push(sum(s)); }

  const evVal = sum(evSquad), levVal = sum(levSquad);
  const evP = pct(evVal, dist), levP = pct(levVal, dist);
  agg.evPct.push(evP); agg.levPct.push(levP); agg.evKr.push(evVal); agg.levKr.push(levVal);
  agg.evOwn.push(ownAvg(evSquad)); agg.levOwn.push(ownAvg(levSquad));
  if (evP >= 0.9) agg.evTop++; if (levP >= 0.9) agg.levTop++;

  console.log(`   ${pad(n, 3)}  ${SCALE[n].padEnd(8)} ${pad((evP * 100).toFixed(0) + '%', 6)} ${pad((levP * 100).toFixed(0) + '%', 5)}  | ${pad(kr(evVal), 10)} ${pad(kr(levVal), 10)} | ${(ownAvg(evSquad) * 100).toFixed(0)}% / ${(ownAvg(levSquad) * 100).toFixed(0)}%`);
}
const testable = agg.evPct.length;

console.log('\n' + '─'.repeat(80));
if (testable === 0) {
  console.log('  KONKLUSION: 0 af 5 runder var testbare — EV-modellen kan ikke identificere');
  console.log('  positive-EV picks fra de tynde, tidlige Dauphiné-data (cold-start), særligt på');
  console.log('  bjergetaper hvor baseline er dybt negativ. Leverage-hypotesen kan derfor IKKE');
  console.log('  backtestes på Dauphiné med nuværende data. Se vurdering nederst.');
  console.log('═'.repeat(80));
  process.exit(0);
}
console.log(`  SAMLET (gennemsnit over ${testable} TESTBARE runder)`);
console.log(`  Felt-percentil:   EV-max ${(mean(agg.evPct) * 100).toFixed(1)}%   |  leverage ${(mean(agg.levPct) * 100).toFixed(1)}%   (højere = længere oppe i feltet)`);
console.log(`  Top-10%-finishes: EV-max ${agg.evTop}/5            |  leverage ${agg.levTop}/5`);
console.log(`  Realiseret kr:    EV-max ${kr(agg.evKr.reduce((a, b) => a + b, 0))}  |  leverage ${kr(agg.levKr.reduce((a, b) => a + b, 0))}`);
console.log(`  Gns. ejerandel:   EV-max ${(mean(agg.evOwn) * 100).toFixed(0)}%          |  leverage ${(mean(agg.levOwn) * 100).toFixed(0)}%  (lavere = mere kontrær)`);

const upLift = mean(agg.levPct) - mean(agg.evPct);
const evCost = agg.evKr.reduce((a, b) => a + b, 0) - agg.levKr.reduce((a, b) => a + b, 0);
const valid = mean(agg.evOwn) > mean(agg.levOwn); // EV-max must be the higher-owned (chalk) side
console.log('\n  VALIDITETS-GATE:');
if (!valid) {
  console.log(`  ✗ UGYLDIG: EV-max ejes ${(mean(agg.evOwn) * 100).toFixed(0)}% < leverage ${(mean(agg.levOwn) * 100).toFixed(0)}% — EV-max opfører sig`);
  console.log('    IKKE som chalk, så sammenligningen isolerer ikke leverage. Konklusionen nedenfor');
  console.log('    er IKKE troværdig; EV-prædiktoren skal forbedres (mere/tidligere data, bedre fit).');
} else {
  console.log(`  ✓ EV-max ejes ${(mean(agg.evOwn) * 100).toFixed(0)}% > leverage ${(mean(agg.levOwn) * 100).toFixed(0)}% — EV-max ER den mere chalk-tunge side. Testen er gyldig.`);
}
console.log('\n  VURDERING (ærlig):');
console.log(`  • Rykker leverage dig OP? ${upLift > 0.02 ? 'JA' : upLift < -0.02 ? 'NEJ' : 'NEUTRALT'} — felt-percentil ${(upLift >= 0 ? '+' : '')}${(upLift * 100).toFixed(1)} pp vs EV-max.`);
console.log(`  • Koster det EV? ${evCost > 0 ? 'JA, ' + kr(evCost) + ' kr mindre realiseret' : 'NEJ (' + kr(-evCost) + ' kr mere)'} over 5 runder.`);
console.log(`  • Kontrær-tjek: leverage-holdet ejes ${(mean(agg.evOwn) * 100).toFixed(0)}%→${(mean(agg.levOwn) * 100).toFixed(0)}% (differentiering bekræftet).`);
if (upLift <= 0.02) {
  console.log('  ⚠ ADVARSEL: leverage rykker dig IKKE tydeligt op på Dauphinés faktiske udfald.');
  console.log('    Det er ÉN realisering (5 runder) + syntetisk felt — men det er et rødt flag for');
  console.log('    kernestrategien. Skal stress-testes på flere udfald før vi stoler på den.');
} else {
  console.log('  → Leverage rykker dig op på dette udfald, mod en EV-pris. Konsistent med §2-tesen,');
  console.log('    men ÉT udfald — bekræft på flere løb/udfald før den låses.');
}
console.log('═'.repeat(80));
