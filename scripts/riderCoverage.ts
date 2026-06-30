// scripts/riderCoverage.ts
// Coverage report for rider season-history files (fixtures/riders/). For each
// result row it asks: can we attach a profile by EXACT lookup (race we have a
// stages-file for) or only by VERT/KM FALLBACK (uncovered race / one-day)?
// Classification rows are dropped (standings, not stage results). Weighted by
// recency as-of the Tour start, separately for form (HL 30d) and profileFit
// (HL 120d) — because that tells us where the model's signal mass actually sits,
// and which uncovered races (if any) are worth fetching stages-files for.
//
//   npx tsx scripts/riderCoverage.ts [ridersDir] [asOf=2026-07-04]
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';

const f = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const ridersDir = process.argv[2] ? process.argv[2] : f('fixtures/riders');
const asOf = new Date(process.argv[3] || '2026-07-04');
const HL = (days: number, hl: number) => Math.pow(0.5, days / hl);

// covered races = those we have a stages-file for (exact profile lookup possible)
const covered = new Set<string>();
for (const file of readdirSync(f('fixtures/pcs'))) {
  const m = file.match(/^(.+)-(\d{4})-stages\.json$/);
  if (m) { const j = JSON.parse(readFileSync(f(`fixtures/pcs/${file}`), 'utf8')); covered.add(`${j.race?.slug ?? m[1]}-${m[2]}`); }
}

const acc = { exact: { f: 0, fit: 0, n: 0 }, fbStage: { f: 0, fit: 0, n: 0 }, fbOneday: { f: 0, fit: 0, n: 0 }, dropped: 0 };
const uncoveredFit = new Map<string, { fit: number; n: number }>();
let riders = 0;

for (const file of readdirSync(ridersDir).filter((x) => /^rider-.*\.json$/.test(x))) {
  const j = JSON.parse(readFileSync(`${ridersDir}/${file}`, 'utf8'));
  riders++;
  for (const r of j.results || []) {
    if (r.rowType === 'classification') { acc.dropped++; continue; }
    if (!r.date) continue;
    const age = (asOf.getTime() - new Date(r.date).getTime()) / 86_400_000;
    if (age < 0) continue;
    const wF = HL(age, 30), wFit = HL(age, 120);
    const key = `${r.raceSlug}-${r.year}`;
    const isExact = r.rowType === 'stage' && covered.has(key);
    const bucket = isExact ? acc.exact : (r.rowType === 'stage' ? acc.fbStage : acc.fbOneday);
    bucket.f += wF; bucket.fit += wFit; bucket.n++;
    if (!isExact) { const u = uncoveredFit.get(key) || { fit: 0, n: 0 }; u.fit += wFit; u.n++; uncoveredFit.set(key, u); }
  }
}

const totF = acc.exact.f + acc.fbStage.f + acc.fbOneday.f;
const totFit = acc.exact.fit + acc.fbStage.fit + acc.fbOneday.fit;
const pc = (x: number, t: number) => t ? (100 * x / t).toFixed(0) + '%' : '–';
console.log('═'.repeat(74));
console.log(`  RYTTER-COVERAGE — ${riders} rytter(e), as-of ${asOf.toISOString().slice(0, 10)}`);
console.log('═'.repeat(74));
console.log('  Dækkede løb (eksakt profil-opslag):', [...covered].join(', '));
console.log('  Recency-vægtet andel af signal-masse pr. kilde:\n');
console.log('  kilde                      form-vægt   profileFit-vægt   rækker');
console.log(`  eksakt opslag (dækket)     ${pc(acc.exact.f, totF).padStart(7)}     ${pc(acc.exact.fit, totFit).padStart(8)}        ${acc.exact.n}`);
console.log(`  fallback: etape (udækket)  ${pc(acc.fbStage.f, totF).padStart(7)}     ${pc(acc.fbStage.fit, totFit).padStart(8)}        ${acc.fbStage.n}`);
console.log(`  fallback: endagsløb        ${pc(acc.fbOneday.f, totF).padStart(7)}     ${pc(acc.fbOneday.fit, totFit).padStart(8)}        ${acc.fbOneday.n}`);
console.log(`  (droppede classification-rækker: ${acc.dropped})`);

console.log('\n  Udækkede løb rangeret efter profileFit-vægt (kandidater til stages-fil):');
[...uncoveredFit.entries()].sort((a, b) => b[1].fit - a[1].fit).slice(0, 10)
  .forEach(([k, v]) => console.log(`    ${k.padEnd(28)} fit-vægt ${v.fit.toFixed(2)}  (${v.n} rækker)`));

console.log('\n  TOLKNING:');
console.log('  • Høj eksakt-andel i FORM ⇒ juni-prep-løbet er dækket (godt).');
console.log('  • Stor fallback-andel i profileFit ⇒ den dominerende komponent hviler på vert/km-');
console.log('    fallback for april–maj. Et udækket løb med stor fit-vægt OG mange ryttere er en');
console.log('    god kandidat til at hente en stages-fil for (konverter fallback→eksakt).');
console.log('  • Endagsløb (klassikere) maps dårligt til profilerne (ingen brosten-profil) → de');
console.log('    bidrager mest til FORM; profileFit derfra er støj. Lav vægt, lav bekymring.');
console.log('═'.repeat(74));
