// scripts/snippets/pcs-results.js
// SOLUTION A — run this in the browser console while viewing a PCS stage
// RESULT page, e.g.
//   https://www.procyclingstats.com/race/tour-de-france/2025/stage-1/result/result
// Your real browser session passes PCS bot-detection. It reads the results
// table straight from the rendered DOM (no fetch) and copies clean JSON to the
// clipboard. Paste that JSON into a file under fixtures/pcs/.
//
// Defensive by design: it locates the results table by the presence of rider
// links rather than fixed CSS classes, and reads rank/status/team resiliently.
// If it logs "Ingen resultattabel fundet", copy the console output to Claude and
// the selector will be adjusted.

(() => {
  const path = location.pathname; // /race/{slug}/{year}/stage-N/result/result
  const m = path.match(/\/race\/([^/]+)\/(\d{4})\/(?:stage-(\d+)|(prologue))/);
  const race = m ? { slug: m[1], year: +m[2] } : { slug: null, year: null };
  const stageNo = m ? (m[4] ? 0 : m[3] ? +m[3] : null) : null;

  // The results table is the one that actually contains rider links.
  const table = [...document.querySelectorAll('table')]
    .find((t) => t.querySelector('a[href*="rider/"]'));
  if (!table) { console.warn('Ingen resultattabel fundet — kopiér denne besked til Claude.'); return; }

  const results = [...table.querySelectorAll('tbody tr')].map((tr) => {
    const riderA = tr.querySelector('a[href*="rider/"]');
    if (!riderA) return null;
    const teamA = tr.querySelector('a[href*="team/"]');
    const lead = (tr.children[0]?.innerText || '').trim();
    const rank = /^\d+$/.test(lead) ? +lead : null;
    const status = rank === null ? (lead || 'NR').toUpperCase() : 'OK';
    const slug = (riderA.getAttribute('href').split('rider/')[1] || '').split(/[/?#]/)[0];
    return {
      rank,
      status,
      riderSlug: slug,
      riderName: riderA.innerText.trim(),
      team: teamA ? teamA.innerText.trim() : null,
    };
  }).filter(Boolean);

  // Distance often appears in the page title as "(184.9km)".
  const dist = (document.title.match(/\(([\d.]+)\s*km\)/) || [])[1];

  const out = {
    race,
    stage: { stageNo, distanceKm: dist ? +dist : null },
    results,
    sourceUrl: location.href,
    capturedAt: new Date().toISOString(),
  };
  copy(JSON.stringify(out, null, 2));
  console.log(`PCS: ${results.length} resultater kopieret (${race.slug} ${race.year}, etape ${stageNo}). Gem som fixtures/pcs/${race.slug}-${race.year}-stage-${stageNo}.json`);
})();
