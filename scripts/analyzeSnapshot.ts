// scripts/analyzeSnapshot.ts
// Dagligt chalk/leverage/enabler-read af et holdet-snapshot. Spejler surfacens
// join (matchForm) + model (form + β·fit → værdikurve) + de officielle γ/DNF,
// men i terminalen: så hver morgens pull giver et øjeblikkeligt overblik uden
// browser. Bruger public/data/form-snapshot.json som model-kilde.
//
//   npx tsx scripts/analyzeSnapshot.ts [sti-til-snapshot] [profil]
//   (default: fixtures/holdet/tour-de-france-2026-after-stage-0.json, mountain)
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

const f = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const argPath = process.argv[2] ?? 'fixtures/holdet/tour-de-france-2026-after-stage-0.json';
const profile = (process.argv[3] ?? 'mountain') as string;

const SNAP = JSON.parse(readFileSync(f('public/data/form-snapshot.json'), 'utf8'));
const snap = JSON.parse(readFileSync(isAbsolute(argPath) ? argPath : f(argPath), 'utf8'));

// --- name join (identisk med surfacens matchForm) --------------------------
const tokensOf = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/[\s-]+/).filter(Boolean);
const nameKey = (s: string) => tokensOf(s).slice().sort().join(' ');
const byKey: Record<string, any> = {}; for (const r of SNAP.riders) byKey[r.key] = r;
const R = SNAP.riders.map((r: any) => { const t = tokensOf(r.name); return { r, set: new Set(r.key.split(' ')), li: t.length ? t[t.length - 1] + '|' + t[0][0] : '' }; });
function matchForm(name: string) {
  const k = nameKey(name); if (byKey[k]) return byKey[k];
  const t = tokensOf(name), set = new Set(t);
  let c = R.filter((x: any) => t.every((y) => x.set.has(y))); if (c.length === 1) return c[0].r;
  c = R.filter((x: any) => [...x.set].every((y) => set.has(y))); if (c.length === 1) return c[0].r;
  const li = t.length ? t[t.length - 1] + '|' + t[0][0] : '';
  c = R.filter((x: any) => x.li === li); if (c.length === 1) return c[0].r;
  return null;
}

// --- model (mirror surface) ------------------------------------------------
const c = SNAP.valueCoeffs, beta = SNAP.evBeta;
const scaleOf = (p: string) => (p === 'mountain' || p === 'break') ? 'mountain' : 'flat';
const valueOfRank = (rank: number, scale: string) => c.baseline[scale] + c.premiumRank1[scale] * Math.exp(-c.decayK * (rank - 1));
const gammaFor = (p: string) => (SNAP.winProbGammaByProfile && SNAP.winProbGammaByProfile[p]) || SNAP.winProbGamma || 1;
const dnfFor = (p: string) => (SNAP.dnfRateByProfile && SNAP.dnfRateByProfile[p]) || 0;
const kr = (n: number) => Math.round(n).toLocaleString('da-DK');

const persons = snap._embedded?.persons ?? {};
const teams = snap._embedded?.teams ?? {};

interface Row { name: string; team: string; price: number; own: number; strength: number; hasForm: boolean; fitObj: any; form: number; }
const rows: Row[] = (snap.items || []).filter((i: any) => !i.isOut).map((i: any) => {
  const p = persons[i.personId] || {}; const name = `${p.firstName || ''} ${p.lastName || ''}`.trim();
  const m = matchForm(name);
  return { name, team: teams[i.teamId]?.name || '?', price: i.price, own: i.popularity ?? 0, strength: m ? m.form + beta * (m.fit[profile] || 0) : 0, hasForm: !!m, fitObj: m ? m.fit : null, form: m ? m.form : 0 };
});

// --- ownership sanity ------------------------------------------------------
const owns = (snap.items || []).map((i: any) => i.popularity).filter((v: any) => v != null);
const nNull = (snap.items || []).filter((i: any) => i.popularity == null).length;
const active = rows.length, noForm = rows.filter((r) => !r.hasForm).length;
console.log('═'.repeat(74));
console.log(`  SNAPSHOT-ANALYSE: ${argPath}  ·  profil = ${profile}`);
console.log('═'.repeat(74));
console.log(`  ${snap.items?.length ?? 0} rytter-rækker · ${active} aktive (isOut fjernet) · ${noForm} uden form-match`);
console.log(`  ejer%: ${owns.length} med tal, ${nNull} null · max ${(Math.max(...owns) * 100).toFixed(1)}% · Σejer ${(owns.reduce((a: number, b: number) => a + b, 0)).toFixed(2)} (≈ 8,0 når feltet er fuldt tegnet: hver manager vælger 8 ryttere)`);
if (!owns.length || Math.max(...owns) === 0) { console.log('\n  ⚠ INGEN ejerandele endnu (spillet ikke låst?) — leverage = expΔ indtil da.'); }

// --- model expΔ + leverage (samme kæde som surfacen, uden MC for fart) ------
rows.sort((a, b) => b.strength - a.strength);
rows.forEach((r, i) => {
  (r as any).predRank = i + 1;
  const gross = valueOfRank(i + 1, scaleOf(profile));           // deterministisk approx
  const pDnf = dnfFor(profile);
  (r as any).ev = (1 - pDnf) * gross + pDnf * (-75000);
  (r as any).lev = (r as any).ev > 0 ? (r as any).ev * (1 - r.own) : -Infinity;
  (r as any).perMio = r.price > 0 ? (r as any).ev / (r.price / 1e6) : 0;
});

const fmt = (r: any, extra = '') => `${r.name.padEnd(24)} ${String(r.team).slice(0, 22).padEnd(23)} ${(r.own * 100).toFixed(1).padStart(5)}%  ${kr(r.price).padStart(11)}  expΔ ${kr(r.ev).padStart(8)}${extra}`;

console.log('\n  CHALK (mest ejede — feltets kerne):');
[...rows].sort((a, b) => b.own - a.own).slice(0, 12).forEach((r, i) => console.log(`  ${String(i + 1).padStart(2)}. ${fmt(r)}`));

console.log(`\n  LEVERAGE-PICKS på ${profile} (expΔ × (1−ejer), positiv EV):`);
[...rows].filter((r: any) => (r as any).lev > -Infinity).sort((a: any, b: any) => (b as any).lev - (a as any).lev).slice(0, 12)
  .forEach((r: any, i) => console.log(`  ${String(i + 1).padStart(2)}. ${fmt(r, `  lev ${kr((r as any).lev).padStart(8)}`)}`));

console.log('\n  ENABLER-CHALK (billig ≤4M + højt ejet — feltets stacking-plays):');
[...rows].filter((r) => r.price <= 4000000).sort((a, b) => b.own - a.own).slice(0, 10)
  .forEach((r, i) => console.log(`  ${String(i + 1).padStart(2)}. ${fmt(r)}`));

// --- E1 TTT: holdenes tempo-styrke + forventet payout ----------------------
const TTT_ENGINES = 5;
const eng = (r: Row) => r.form + beta * ((r.fitObj && r.fitObj.itt) || 0);
const byTeam = new Map<string, Row[]>();
for (const r of rows) { if (!byTeam.has(r.team)) byTeam.set(r.team, []); byTeam.get(r.team)!.push(r); }
const teamStr = [...byTeam.entries()].map(([t, arr]) => {
  const top = arr.map(eng).sort((a, b) => b - a).slice(0, TTT_ENGINES);
  return { team: t, s: top.reduce((a, b) => a + b, 0) / Math.max(top.length, 1), own: arr.reduce((a, b) => a + b.own, 0) };
}).sort((a, b) => b.s - a.s);
const g = gammaFor('ttt'); const tot = teamStr.reduce((a, t) => a + Math.pow(Math.max(0, t.s), g), 0);
console.log('\n  E1 (TTT) — holdenes tempo-styrke + P(vinder) + samlet ejer% på holdet:');
console.log('      hold                         tempo   P(vind)  Σejer% på holdet');
teamStr.slice(0, 8).forEach((t, i) => console.log(`  ${String(i + 1).padStart(2)}. ${t.team.slice(0, 26).padEnd(27)} ${t.s.toFixed(2).padStart(6)}   ${(Math.pow(Math.max(0, t.s), g) / tot * 100).toFixed(0).padStart(3)}%     ${(t.own * 100).toFixed(0)}%`));
console.log('═'.repeat(74));
