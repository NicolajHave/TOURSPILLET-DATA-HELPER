// scripts/snippets/pcs-results.js (v2)
// Kør i browser-konsollen på en PCS etape-resultatside.
// Håndterer både /race/{slug}/{år}/stage-N og race.php?id1=...-URL-formaterne.
(() => {
  const src = location.pathname + location.search;
  const m = src.match(/race(?:\.php)?\/([^/?&]+)\/(\d{4})\/(?:stage-(\d+)|(prologue))/)
         || src.match(/id1=([^&]+)&id2=(\d{4})&id3=stage-(\d+)/);
  const race = m ? { slug: m[1], year: +m[2] } : { slug: null, year: null };
  const stageNo = m ? (m[4] ? 0 : m[3] ? +m[3] : null) : null;

  const table = [...document.querySelectorAll('table')]
    .find((t) => t.querySelector('a[href*="rider"]'));
  if (!table) { console.warn('Ingen resultattabel fundet — kopiér denne besked til Claude.'); return; }

  const results = [...table.querySelectorAll('tbody tr')].map((tr) => {
    const riderA = tr.querySelector('a[href*="rider"]');
    if (!riderA) return null;
    const teamA = tr.querySelector('a[href*="team"]');
    const lead = (tr.children[0]?.innerText || '').trim();
    const rank = /^\d+$/.test(lead) ? +lead : null;
    const status = rank === null ? (lead || 'NR').toUpperCase() : 'OK';
    const href = riderA.getAttribute('href') || '';
    const slug = (href.split(/rider\/?/)[1] || '').split(/[/?#&]/)[0];
    return {
      rank,
      status,
      riderSlug: slug,
      riderName: riderA.innerText.trim(),
      team: teamA ? teamA.innerText.trim() : null,
    };
  }).filter(Boolean);

  const dist = (document.title.match(/\(([\d.]+)\s*km\)/) || [])[1];

  const out = {
    race,
    stage: { stageNo, distanceKm: dist ? +dist : null },
    results,
    sourceUrl: location.href,
    capturedAt: new Date().toISOString(),
  };
  copy(JSON.stringify(out, null, 2));
  console.log(`PCS: ${results.length} resultater kopieret (${race.slug ?? '?'} ${race.year ?? '?'}, etape ${stageNo ?? '?'}).`);
})();
