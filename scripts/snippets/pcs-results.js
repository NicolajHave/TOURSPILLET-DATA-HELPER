// scripts/snippets/pcs-results.js (v3)
// Kør i browser-konsollen på en PCS etape-resultatside.
// Håndterer både /race/{slug}/{år}/stage-N og race.php?id1=...-URL-formaterne.
// v3: fanger nu også stage-difficulty fra siden — distance, højdemeter,
// ProfileScore (hele etapen) og ProfileScore FINAL (sidste 25 km). Final-scoren
// er PCS' egen måde at skelne klatre-/bjergankomster fra spurt-etaper, så den er
// det stærkeste enkeltsignal til klassifikation (bedre end det race-relative ikon).
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

  // --- stage difficulty (best-effort; PCS markup varies) -------------------
  const pageText = document.body.innerText.replace(/ /g, ' ');
  const num = (re) => { const x = pageText.match(re); return x ? +x[1].replace(/[^\d]/g, '') : null; };
  const dist = (document.title.match(/\(([\d.]+)\s*km\)/) || [])[1]
    || (pageText.match(/Distance:?\s*([\d.]+)\s*km/i) || [])[1];
  // "ProfileScore: 142" and "ProfileScore final: 88" (label wording varies a bit)
  const profileScore = num(/ProfileScore\s*:?\s*(\d+)/i);
  const profileScoreFinal = num(/ProfileScore\s*(?:final|finale|last)\b[^\d]*(\d+)/i);
  const verticalM = num(/(?:Vertical\s*met(?:er|re)s?|Elevation\s*gain)\s*:?\s*([\d.,]+)\s*m?/i);

  const out = {
    race,
    stage: {
      stageNo,
      distanceKm: dist ? +dist : null,
      verticalM,
      profileScore,
      profileScoreFinal,
    },
    results,
    sourceUrl: location.href,
    capturedAt: new Date().toISOString(),
  };
  copy(JSON.stringify(out, null, 2));
  console.log(`PCS: ${results.length} resultater (${race.slug ?? '?'} ${race.year ?? '?'}, etape ${stageNo ?? '?'}). `
    + `ProfileScore=${profileScore ?? '?'} final=${profileScoreFinal ?? '?'} vert=${verticalM ?? '?'}m. `
    + `Hvis score er '?', send en linje af siden til Claude.`);
})();
