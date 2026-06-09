// scripts/proveSlice1.ts
// Validates the transport-independent core of slice 1: stage classifier + form.
// Run: npx tsx scripts/proveSlice1.ts
import { classifyStage, archetypeWeights, type StageFeatures } from '../src/lib/stageProfile';
import { form, profileFit, type Result } from '../src/lib/form';

// --- Classifier: labelled stages (illustrative features, real archetypes) ---
const cases: Array<{ name: string; expect: string; f: StageFeatures }> = [
  { name: 'TdF25 S1 Lille (bunch sprint)', expect: 'sprint',
    f: { distanceKm: 184.9, verticalM: 800, parcoursType: 'flat' } },
  { name: 'Summit finish (Hautacam-type)', expect: 'mountain',
    f: { distanceKm: 180, verticalM: 4200, summitFinish: true } },
  { name: 'Medium mountain, valley finish', expect: 'break',
    f: { distanceKm: 195, verticalM: 3600, parcoursType: 'mountain_flat_finish' } },
  { name: 'Punchy uphill finish', expect: 'punch',
    f: { distanceKm: 165, verticalM: 2100, parcoursType: 'hilly_uphill_finish' } },
  { name: 'Individual time trial', expect: 'itt',
    f: { distanceKm: 33, verticalM: 300, discipline: 'itt' } },
  { name: 'No icon, ProfileScore 120', expect: 'mountain',
    f: { distanceKm: 170, verticalM: 3900, profileScore: 120 } },
  { name: 'No icon, only vertical (flat)', expect: 'sprint',
    f: { distanceKm: 200, verticalM: 900 } },
];

let pass = 0;
console.log('=== STAGE CLASSIFIER ===');
for (const c of cases) {
  const got = classifyStage(c.f);
  const ok = got === c.expect;
  pass += ok ? 1 : 0;
  console.log(`  [${ok ? 'OK' : 'XX'}] ${c.name.padEnd(34)} -> ${got}${ok ? '' : `  (expected ${c.expect})`}`);
}
console.log(`  ${pass}/${cases.length} correct`);

console.log('\n=== ARCHETYPE WEIGHTS (mountain) ===');
console.log('  ', archetypeWeights('mountain'));

// --- Form: a climber peaking in June vs a fading spring form ---
const asOf = new Date('2025-07-05'); // TdF 2025 start
const climber: Result[] = [
  { riderId: 1, date: '2025-06-13', profile: 'mountain', rank: 2, finished: true },  // Dauphiné, fresh
  { riderId: 1, date: '2025-06-15', profile: 'mountain', rank: 1, finished: true },
  { riderId: 1, date: '2025-03-20', profile: 'mountain', rank: 8, finished: true },  // old
];
const springGuy: Result[] = [
  { riderId: 2, date: '2025-03-22', profile: 'mountain', rank: 1, finished: true },  // great but old
  { riderId: 2, date: '2025-06-14', profile: 'mountain', rank: 25, finished: true }, // recent, weak
];
console.log('\n=== FORM (as of TdF25 start) ===');
console.log('  June-peaking climber:', form(climber, asOf));
console.log('  Spring-form fader:   ', form(springGuy, asOf));
console.log('  -> recent form correctly outweighs old results:',
  form(climber, asOf) > form(springGuy, asOf));

console.log('\n=== PROFILE-FIT (mountain) ===');
console.log('  Climber mountain fit:', profileFit(climber, 'mountain', asOf));
console.log('  Fader mountain fit:  ', profileFit(springGuy, 'mountain', asOf));
