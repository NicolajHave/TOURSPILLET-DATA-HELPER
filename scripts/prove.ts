// scripts/prove.ts
// Runs the real parser + rule engine on the Dauphiné fixture extracted from the
// HAR, to prove the pipeline end-to-end before the Tour game opens.
// Run:  npx tsx scripts/prove.ts
import { readFileSync } from 'node:fs';
import { parsePlayersResponse, toFlatRows, type RawPlayersResponse } from '../src/lib/parseSnapshot';
import { leverageScore, buyAndHoldNet, breakEvenRise, DAUPHINE_2026 } from '../src/lib/ruleset';

const raw = JSON.parse(
  readFileSync(new URL('../fixtures/dauphine_players_raw.json', import.meta.url), 'utf-8'),
) as RawPlayersResponse;

const parsed = parsePlayersResponse(raw);
console.log('PARSED:', {
  riders: parsed.riders.length,
  teams: parsed.teams.length,
  gamePlayers: parsed.gamePlayers.length,
  snapshots: parsed.snapshots.length,
});

const flat = toFlatRows(raw);
const kr = (n: number) => n.toLocaleString('da-DK');

// NOTE: realized delta (price - startPrice) is used here as a STAND-IN for the
// model's expectedDelta, purely to demonstrate the leverage mechanic on real
// numbers. The predictive expectedDelta arrives in the next slice (PCS form +
// stage-profile fit).
const withLev = flat.map((r) => ({
  ...r,
  leverage: leverageScore({ expectedDelta: r.delta, popularity: r.ownershipPct / 100 }),
}));

console.log('\n=== CHALK (top ownership — what the field maximises) ===');
[...withLev].sort((a, b) => b.ownershipPct - a.ownershipPct).slice(0, 6).forEach((r) =>
  console.log(`  ${r.name.padEnd(22)} ${String(r.ownershipPct).padStart(5)}%  delta ${kr(r.delta).padStart(10)}`),
);

console.log('\n=== LEVERAGE PICKS (delta x (1 - ownership) — what wins the field) ===');
[...withLev].sort((a, b) => b.leverage - a.leverage).slice(0, 6).forEach((r) =>
  console.log(`  ${r.name.padEnd(22)} ${String(r.ownershipPct).padStart(5)}%  delta ${kr(r.delta).padStart(10)}  lev ${kr(Math.round(r.leverage))}`),
);

console.log('\n=== FEE GATE (would a 1-round buy clear its own cost?) ===');
console.log(`  Break-even rise needed: > ${(breakEvenRise() * 100).toFixed(1)}% of price`);
['Alex Baudin', 'Isaac Del Toro', 'Paul Seixas'].forEach((name) => {
  const r = flat.find((x) => x.name === name);
  if (!r) return;
  const net = buyAndHoldNet(r.startPrice, r.price, DAUPHINE_2026);
  console.log(`  ${name.padEnd(22)} gross ${kr(r.delta).padStart(9)}  fee ${kr(Math.round(r.startPrice * 0.01)).padStart(8)}  -> net ${kr(net).padStart(9)} ${net > 0 ? 'OK' : 'NO'}`);
});
