// scripts/calibrateDnf.ts
// Empirisk DNF/DNS-hazard pr. etapeprofil. Forecasterens flade default (3 %)
// er et gæt — her måler vi den faktiske udgåelsesrate på TdF+Vuelta 2025 +
// Dauphiné/Suisse 2026. Event = DNF (udgår undervejs) ELLER DNS (stiller ikke
// til start; set fra "jeg ejer rytteren" er begge = tabt rytter omkring den
// etape). Nævner = startere (OK+DNF). Neutraliserede etaper (Vuelta E11 'DF',
// alle rank=null) er allerede ekskluderet af no-usable-result-guarden i
// loadRace — vi joiner rå statusfiler mod loadRace-profilerne, så kun brugbare
// etaper tæller.
//
//   npx tsx scripts/calibrateDnf.ts
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRace } from '../src/lib/raceData';

const PCS = fileURLToPath(new URL('../fixtures/pcs', import.meta.url));

const RACES: Array<[string, string, number, boolean]> = [
  ['TdF25', 'tour-de-france', 2025, false],
  ['Vuelta25', 'vuelta-a-espana', 2025, true],
  ['Dauphine26', 'dauphine', 2026, true],
  ['Suisse26', 'tour-de-suisse', 2026, true],
];

const perProfile: Record<string, { starters: number; events: number; stages: number }> = {};
let starters = 0, events = 0, stages = 0;

for (const [label, slug, year, prefPs] of RACES) {
  for (const st of loadRace(PCS, label, slug, year, prefPs)) {
    const raw = JSON.parse(readFileSync(join(PCS, `${slug}-${year}-stage-${st.stageNo}.json`), 'utf8'));
    const res: any[] = raw.results ?? [];
    const s = res.filter((x) => x.status === 'OK' || x.status === 'DNF').length;
    const e = res.filter((x) => x.status === 'DNF' || x.status === 'DNS').length;
    const p = (perProfile[st.profile] ??= { starters: 0, events: 0, stages: 0 });
    p.starters += s; p.events += e; p.stages++;
    starters += s; events += e; stages++;
  }
}

const pooled = events / starters;
console.log('═'.repeat(66));
console.log('  DNF/DNS-HAZARD PR. PROFIL (event = DNF eller DNS, nævner = startere)');
console.log('═'.repeat(66));
console.log(`  ${stages} brugbare etaper · ${starters} rytter-starter · ${events} events`);
console.log(`  POOLET: ${(pooled * 100).toFixed(2)} % pr. rytter pr. etape (forecaster-default var 3 %!)\n`);
console.log('  profil     etaper  startere  events   rate     (n<5 events → poolet)');
const byProfile: Record<string, number> = {};
for (const [prof, p] of Object.entries(perProfile).sort()) {
  const rate = p.events / p.starters;
  const use = p.events >= 5 ? rate : pooled;
  byProfile[prof] = +use.toFixed(4);
  console.log(`  ${prof.padEnd(9)} ${String(p.stages).padStart(5)} ${String(p.starters).padStart(9)} ${String(p.events).padStart(7)}   ${(rate * 100).toFixed(2)} %${p.events < 5 ? '  → poolet' : ''}`);
}
console.log(`\n  ⇒ DNF_RATE_BY_PROFILE = ${JSON.stringify(byProfile)}`);
console.log(`  ⇒ DNF_RATE_POOLED = ${+pooled.toFixed(4)}`);
console.log('  → sæt værdierne i src/lib/evModel.ts.');
console.log('═'.repeat(66));
