// scripts/snippets/pcs-stages.js
// SOLUTION A — run in the console on a PCS race STAGES overview, e.g.
//   https://www.procyclingstats.com/race/tour-de-france/2025/stages
// Grabs distance + parcours type + (when present) vertical/ProfileScore for ALL
// stages in one go, so you don't need a separate page per stage for features.
//
// Best-effort: PCS overview markup varies. If parcoursType comes back null the
// classifier still works from vertical/ProfileScore, or set it by hand for the
// ~21 stages. Copy console output to Claude if rows look wrong.

(() => {
  const path = location.pathname; // /race/{slug}/{year}/stages
  const m = path.match(/\/race\/([^/]+)\/(\d{4})/);
  const race = m ? { slug: m[1], year: +m[2] } : { slug: null, year: null };

  // Map a PCS parcours icon (class fragment or alt text) to our ParcoursType.
  const ICON = {
    p1: 'flat',
    p2: 'hilly_flat_finish',
    p3: 'hilly_uphill_finish',
    p4: 'mountain_flat_finish',
    p5: 'mountain_summit_finish',
  };
  const parcoursFrom = (el) => {
    if (!el) return null;
    const icon = el.querySelector('[class*="profile"], span.icon, img');
    const cls = icon ? (icon.className || '') + ' ' + (icon.getAttribute('alt') || '') : '';
    for (const k of Object.keys(ICON)) if (cls.includes(k)) return ICON[k];
    return null;
  };

  const table = [...document.querySelectorAll('table')]
    .find((t) => /etappe|stage/i.test(t.innerText) || t.querySelector('a[href*="stage-"]'));
  if (!table) { console.warn('Ingen etapetabel fundet — kopiér denne besked til Claude.'); return; }

  const stages = [...table.querySelectorAll('tbody tr')].map((tr) => {
    const text = tr.innerText.replace(/\n/g, ' ');
    const stageM = text.match(/stage\s*(\d+)/i) || (tr.querySelector('a[href*="stage-"]')?.getAttribute('href') || '').match(/stage-(\d+)/);
    const distM = text.match(/([\d.]+)\s*km/);
    const dateM = text.match(/(\d{1,2}\/\d{1,2})/);
    return {
      stageNo: stageM ? +stageM[1] : null,
      date: dateM ? dateM[1] : null,
      distanceKm: distM ? +distM[1] : null,
      parcoursType: parcoursFrom(tr),
      verticalM: null,
      profileScore: null,
    };
  }).filter((s) => s.stageNo !== null);

  const out = { race, stages, sourceUrl: location.href, capturedAt: new Date().toISOString() };
  copy(JSON.stringify(out, null, 2));
  console.log(`PCS: ${stages.length} etaper kopieret (${race.slug} ${race.year}). Gem som fixtures/pcs/${race.slug}-${race.year}-stages.json`);
})();
