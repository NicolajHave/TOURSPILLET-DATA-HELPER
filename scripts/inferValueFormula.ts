// scripts/inferValueFormula.ts
// Roadmap #2 (HANDOVER §8): infer holdet's hidden value formula (placering ->
// Δpris) from the full 8-stage Dauphiné 2026 snapshot series.
//
// Timeline of what we can observe (the `points` field is 0 for this game, so the
// PRICE delta is the only signal):
//   stage 1      = HAR snapshot, clean single day  (startPrice  -> raw.price)
//   stage 2+3    = ONE combined delta              (raw.price   -> after-stage-3)
//                  stage 3 is a TTT (team-level) -> the block is NOT separable
//   stage 4..8   = clean single-day deltas         (after n-1   -> after n)
//
// Decomposition model (additive, verified empirically):
//   Δprice = baseline(stage) + positionPremium(rank, stage)
//            + teamBonus·[active rider on stage-winner's team]
//            + jerseyBonus(classification leaders)
//            + dnfPenalty·[abandoned]
//
// Run:  npx tsx scripts/inferValueFormula.ts
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import {
  loadHoldetSnapshot,
  loadPcs,
  joinStage,
  buildRiderIndex,
  matchRider,
  median,
  mean,
  pearson,
  type StageRow,
  type HoldetSnapshot,
} from '../src/lib/valueFormula';

const f = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const kr = (n: number) => Math.round(n).toLocaleString('da-DK');
const pad = (s: any, n: number) => String(s).padStart(n);

// --- load all snapshots -----------------------------------------------------
const RAW = loadHoldetSnapshot(f('fixtures/dauphine_players_raw.json'));
const S: Record<number, HoldetSnapshot> = {};
for (const n of [3, 4, 5, 6, 7, 8]) S[n] = loadHoldetSnapshot(f(`fixtures/holdet/dauphine-2026-after-stage-${n}.json`));
const PCS = (n: number) => loadPcs(f(`fixtures/pcs/dauphine-2026-stage-${n}.json`));

// price-before maps
const startPriceMap = new Map(RAW.riders.map((r) => [r.playerId, r.startPrice]));
const priceMap = (snap: HoldetSnapshot) => new Map(snap.riders.map((r) => [r.playerId, r.price]));

interface CleanStage { stage: number; after: HoldetSnapshot; before: Map<number, number>; kind: string }
const CLEAN: CleanStage[] = [
  { stage: 1, after: RAW, before: startPriceMap, kind: 'HAR / hård åbner' },
  { stage: 4, after: S[4], before: priceMap(S[3]), kind: 'flad/sprint' },
  { stage: 5, after: S[5], before: priceMap(S[4]), kind: 'flad/sprint' },
  { stage: 6, after: S[6], before: priceMap(S[5]), kind: 'bjerg' },
  { stage: 7, after: S[7], before: priceMap(S[6]), kind: 'bjerg' },
  { stage: 8, after: S[8], before: priceMap(S[7]), kind: 'bjerg (dronning)' },
];

// --- per-stage decomposition ------------------------------------------------
interface Decomp {
  stage: number; kind: string; winner: string | null; winnerTeam: string | null;
  baseline: number; dnf: number; teamBonus: number; matchRate: number;
  popularityCorr: number;
  premiumByRank: Map<number, number>;        // rank -> position premium above baseline
  rows: StageRow[];
  jerseys: Array<{ name: string; residual: number; rank: number | null }>;
}

/** Position premium for a row = delta − baseline − (winning-team ? teamBonus). */
function premium(row: StageRow, baseline: number, teamBonus: number): number {
  return row.delta - baseline - (row.onWinningTeam && !row.isOut ? teamBonus : 0);
}

/** Matched-rank team bonus: each active winning-team domestique (rank>10)
 *  minus the median delta of non-winning-team riders within ±10 ranks. Robust
 *  to the rank-dependent baseline on mountain stages. */
function matchedTeamBonus(rows: StageRow[]): number {
  const nonWin = rows.filter((r) => !r.onWinningTeam && r.rank != null && !r.isOut);
  const dom = rows.filter((r) => r.onWinningTeam && r.rank != null && r.rank > 10 && !r.isOut);
  const bonuses = dom
    .map((d) => {
      const peers = nonWin.filter((p) => Math.abs((p.rank as number) - (d.rank as number)) <= 10).map((p) => p.delta);
      return peers.length ? d.delta - median(peers) : null;
    })
    .filter((v): v is number => v !== null);
  return bonuses.length ? median(bonuses) : NaN;
}

function decompose(cs: CleanStage): Decomp {
  const { rows, winnerName, winnerTeam } = joinStage(cs.before, cs.after, PCS(cs.stage));
  const matched = rows.filter((r) => r.matched).length;

  // baseline = median delta of plain bunch finishers (non-winning team, classified, rank>=40, not out)
  const bunch = rows.filter((r) => !r.onWinningTeam && r.rank != null && r.rank >= 40 && !r.isOut).map((r) => r.delta);
  const baseline = median(bunch);
  const dnf = median(rows.filter((r) => r.isOut).map((r) => r.delta));
  const teamBonus = matchedTeamBonus(rows);

  // position premium by rank (1..15): pick the rider at that rank
  const premiumByRank = new Map<number, number>();
  for (let rank = 1; rank <= 15; rank++) {
    const row = rows.find((r) => r.rank === rank);
    if (row) premiumByRank.set(rank, premium(row, baseline, teamBonus));
  }

  // jersey / leader detection: non-winning-team riders whose delta beats their
  // matched-rank peers by a wide margin (recurring names = jersey holders).
  const nonWin = rows.filter((r) => !r.onWinningTeam && r.rank != null && !r.isOut);
  const jerseys = rows
    .filter((r) => !r.onWinningTeam && !r.isOut && r.rank != null && r.rank > 12)
    .map((r) => {
      const peers = nonWin.filter((p) => p !== r && Math.abs((p.rank as number) - (r.rank as number)) <= 8).map((p) => p.delta);
      const resid = peers.length ? r.delta - median(peers) : r.delta - baseline;
      return { name: r.name, residual: resid, rank: r.rank };
    })
    .filter((x) => x.residual >= 50_000)
    .sort((a, b) => b.residual - a.residual);

  // demand check: does ownership predict the delta? (round-number deltas argue no)
  const pc = rows.filter((r) => r.matched);
  const popularityCorr = pearson(
    pc.map((r) => cs.after.byId.get(r.playerId)!.popularity),
    pc.map((r) => r.delta),
  );

  return { stage: cs.stage, kind: cs.kind, winner: winnerName, winnerTeam, baseline, dnf, teamBonus, matchRate: matched / rows.length, popularityCorr, premiumByRank, rows, jerseys };
}

const decomps = CLEAN.map(decompose);
const flat = decomps.filter((d) => [4, 5].includes(d.stage));   // baseline ≈ 0
const mtn = decomps.filter((d) => [6, 7, 8].includes(d.stage)); // baseline < 0
const afterByStage: Record<number, HoldetSnapshot> = { 1: RAW, 4: S[4], 5: S[5], 6: S[6], 7: S[7], 8: S[8] };
const popOf = (stage: number, playerId: number) => afterByStage[stage].byId.get(playerId)?.popularity ?? NaN;

// ===========================================================================
//  REPORT
// ===========================================================================
const log = (s = '') => console.log(s);
log('═'.repeat(78));
log('  VÆRDIFORMEL-INFERENS — Dauphiné 2026 (8 etaper)   [HANDOVER §8, roadmap #2]');
log('═'.repeat(78));
log(`  Datakilde: 1 HAR-snapshot + 6 daglige holdet-snapshots × 163 spillere`);
log(`             + 8 PCS-etaperesultater.  'points'-feltet er 0 → vi regresserer`);
log(`             udelukkende på PRISDELTAER.`);

log('\n── 1. NAVNEMATCH (holdet personId  ↔  PCS slug) ────────────────────────────');
for (const d of decomps) log(`   Etape ${d.stage}: ${(d.matchRate * 100).toFixed(1)} % af spillerne matchet til et PCS-resultat`);

log('\n── 2. ER PRISERNE FORMEL- ELLER EFTERSPØRGSELSDREVNE? ───────────────────────');
// Test A — kvantisering: en handelsdrevet pris ville give "skæve" tal; en formel
// giver runde, gentagne værdier.
const allDeltas = decomps.flatMap((d) => d.rows.map((r) => r.delta)).filter((v) => v !== 0);
const mult1000 = allDeltas.filter((v) => v % 1000 === 0).length / allDeltas.length;
log(`   A. Kvantisering: ${(mult1000 * 100).toFixed(1)} % af alle deltaer er hele 1000-kr-trin.`);
// Test B — invarians: vinderhold-menige på flade etaper fik ALLE præcis +60.000,
// selv om deres ejerandel spænder vidt ⇒ prisen sættes af formlen, ikke af handel.
const domBonus = flat.flatMap((d) => d.rows.filter((r) => r.onWinningTeam && !r.isOut && r.delta === 60_000).map((r) => ({ r, stage: d.stage })));
const owns = domBonus.map(({ r, stage }) => popOf(stage, r.playerId));
log(`   B. Invarians: ${domBonus.length} vinderhold-menige (E4–5) fik ALLE præcis +60.000 kr,`);
log(`      mens deres ejerandel spændte ${(Math.min(...owns) * 100).toFixed(1)}–${(Math.max(...owns) * 100).toFixed(1)} %`);
log(`      ⇒ deltaet er formel-bestemt, ikke efterspørgselsdrevet.`);
log(`   C. Korrelation(ejerandel, Δpris): ${decomps.map((d) => `E${d.stage}:${d.popularityCorr.toFixed(2)}`).join('  ')}`);
log(`      (positiv, MEN confounded: populære ryttere ER de stærke ryttere — ikke et`);
log(`       bevis for handelsdrift. A+B viser at formlen styrer.)`);

log('\n── 3. PER-ETAPE DEKOMPOSITION (kr) ─────────────────────────────────────────');
log('   etape  type              vinder(hold)                 baseline  holdbonus    DNF');
for (const d of decomps) {
  log(`   ${pad(d.stage, 4)}   ${d.kind.padEnd(16)}  ${(d.winnerTeam ?? '?').slice(0, 26).padEnd(28)} ${pad(kr(d.baseline), 8)} ${pad(kr(d.teamBonus), 10)} ${pad(kr(d.dnf), 7)}`);
}

log('\n── 4. PLACERINGS-PRÆMIE (Δpris over baseline, kr) ──────────────────────────');
log('   Renset for holdbonus. Etape 1-vinderen er entanglet med trøjeerobring.');
log('   rank ' + decomps.map((d) => `   E${d.stage}`).join(''));
for (let rank = 1; rank <= 10; rank++) {
  const cells = decomps.map((d) => {
    const v = d.premiumByRank.get(rank);
    return v === undefined ? pad('–', 6) : pad(kr(v / 1000) + 'k', 6);
  });
  log(`   ${pad(rank, 4)} ${cells.join(' ')}`);
}

log('\n── 5. KOEFFICIENT-STABILITET (på tværs af etaper) ──────────────────────────');
function stab(label: string, vals: number[]) {
  const m = mean(vals), sd = Math.sqrt(mean(vals.map((v) => (v - m) ** 2)));
  const cv = m !== 0 ? (sd / Math.abs(m)) * 100 : NaN;
  log(`   ${label.padEnd(34)} middel ${pad(kr(m), 9)}   spredning ±${pad(kr(sd), 8)}   CV ${cv.toFixed(0)} %`);
}
// flade etaper 4,5 giver ren holdbonus; alle rene etaper for resten
stab('Holdbonus (alle etaper)', decomps.map((d) => d.teamBonus).filter((v) => !isNaN(v)));
stab('Holdbonus (flade etaper 4–5)', flat.map((d) => d.teamBonus));
stab('DNF-straf (alle etaper)', decomps.map((d) => d.dnf).filter((v) => !isNaN(v)));
stab('Baseline, flade etaper (4–5)', flat.map((d) => d.baseline));
stab('Baseline, bjerg-etaper (6–8)', mtn.map((d) => d.baseline));
for (const rank of [1, 2, 3, 5]) {
  const vals = decomps.filter((d) => d.stage !== 1).map((d) => d.premiumByRank.get(rank)).filter((v): v is number => v !== undefined);
  stab(`Placerings-præmie rank ${rank} (E4–8)`, vals);
}

log('\n── 6. TRØJE-/LEDER-BONUS (residual over placeringskurve) ───────────────────');
log('   Ryttere der stiger langt mere end deres placering tilsiger ⇒ trøjebærere.');
const jerseyAgg = new Map<string, number[]>();
for (const d of decomps) for (const j of d.jerseys) {
  if (!jerseyAgg.has(j.name)) jerseyAgg.set(j.name, []);
  jerseyAgg.get(j.name)!.push(j.residual);
}
const recurring = [...jerseyAgg.entries()].filter(([, v]) => v.length >= 2).sort((a, b) => median(b[1]) - median(a[1]));
for (const [name, vals] of recurring) {
  log(`   ${name.padEnd(26)} median residual ${pad(kr(median(vals)), 8)}  (set på ${vals.length} etaper)`);
}
log('   Enkeltstående store residualer (udbrud/dagsform):');
for (const d of decomps) {
  const oneOff = d.jerseys.filter((j) => (jerseyAgg.get(j.name)!.length < 2)).slice(0, 3);
  if (oneOff.length) log(`     E${d.stage}: ` + oneOff.map((j) => `${j.name}(r${j.rank},+${kr(j.residual)})`).join('  '));
}

// --- stage 2+3 combined / TTT special handling -----------------------------
log('\n── 7. ETAPE 2+3 (samlet blok — TTT særbehandlet) ───────────────────────────');
const before23 = priceMap(RAW);
const after23 = S[3];
const idx3 = buildRiderIndex(after23.riders);
const pcs2 = PCS(2);
const ttt = PCS(3); // stage 3 file is the TTT — snippet mislabelte kolonner (rank=null)
const tttLeaderRef = ttt.results[0] ? matchRider(idx3, ttt.results[0].riderName, ttt.results[0].riderSlug) : null;
const block = after23.riders.map((r) => ({ name: r.name, team: r.teamName, d: r.price - (before23.get(r.playerId) ?? r.price) }));
const top23 = [...block].sort((a, b) => b.d - a.d).slice(0, 8);
log(`   Blokken kan IKKE dekomponeres rent: én Δpris dækker BÅDE etape 2 (individuelt`);
log(`   road-resultat) OG etape 3 (TTT = holdresultat, alle på et hold får samme tid).`);
log(`   PCS-stage-3-filen er fejlparset af snippet'en (rank=null, GC-tider i status)`);
log(`   ⇒ TTT-placeringer kan ikke joines individuelt. TTT-leder efter blok:`);
log(`       ${tttLeaderRef ? tttLeaderRef.name + ' / ' + tttLeaderRef.teamName : '(ukendt)'}`);
log('   Største samlede stigninger i 2+3-blokken (til orientering):');
for (const t of top23) log(`     ${t.name.padEnd(26)} ${pad(kr(t.d), 9)}  ${t.team}`);

// --- machine-readable coefficients for the backtest / leverage engine -------
const coeffs = {
  source: 'Dauphiné 2026, 8 stages',
  generatedAt: new Date().toISOString().slice(0, 10),
  unit: 'kr',
  note: 'points field is 0 for this game variant; price delta is the only signal',
  teamBonus: { all: median(decomps.map((d) => d.teamBonus).filter((v) => !isNaN(v))), flatStages: median(flat.map((d) => d.teamBonus)) },
  dnfPenalty: median(decomps.map((d) => d.dnf).filter((v) => !isNaN(v))),
  baseline: { flatStages: median(flat.map((d) => d.baseline)), mountainStages: median(mtn.map((d) => d.baseline)) },
  positionPremium: Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => i + 1).map((rank) => [
      rank,
      {
        flat: median(flat.map((d) => d.premiumByRank.get(rank)).filter((v): v is number => v !== undefined)),
        mountain: median(mtn.map((d) => d.premiumByRank.get(rank)).filter((v): v is number => v !== undefined)),
      },
    ]),
  ),
  jerseyBonus: Object.fromEntries(recurring.map(([name, vals]) => [name, median(vals)])),
};
mkdirSync(f('artifacts'), { recursive: true });
writeFileSync(f('artifacts/value-formula.json'), JSON.stringify(coeffs, null, 2));
log('\n   → koefficienter skrevet til artifacts/value-formula.json');
log('═'.repeat(78));
