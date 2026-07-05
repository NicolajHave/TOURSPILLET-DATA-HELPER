// scripts/snippets/pcs-results.js (v4)
// Kør i browser-konsollen på en PCS etape-resultatside.
// Håndterer både /race/{slug}/{år}/stage-N og race.php?id1=...-URL-formaterne.
//
// v4 (TTT-fix): (1) vælger nu den STØRSTE rytter-tabel (det samlede resultat),
// ikke bare den første — TTT-sider viser hold-undertabeller først, hvilket gav
// kun ét holds 8 ryttere. (2) Position-fallback for rang: mangler en etape en
// ren rang-kolonne (kan ske på TTT under individuel-tids-regler), udledes rang
// af rækkefølgen (rytterne står i mål-orden), mens ægte DNF/DNS/OTL/DSQ forbliver
// uden rang. Normale etaper er upåvirkede (deres rang-kolonne bruges direkte).
// v3-features bevaret: distance, højdemeter, ProfileScore (+final).
(() => {
  const src = location.pathname + location.search;
  const m = src.match(/race(?:\.php)?\/([^/?&]+)\/(\d{4})\/(?:stage-(\d+)|(prologue))/)
         || src.match(/id1=([^&]+)&id2=(\d{4})&id3=stage-(\d+)/);
  const race = m ? { slug: m[1], year: +m[2] } : { slug: null, year: null };
  const stageNo = m ? (m[4] ? 0 : m[3] ? +m[3] : null) : null;

  // Vælg tabellen med FLEST rytter-links (det samlede resultat), ikke den første.
  // (TTT-sider har hold-undertabeller à 8 ryttere før hovedtabellen.)
  const tables = [...document.querySelectorAll('table')]
    .map((t) => ({ t, n: t.querySelectorAll('a[href*="rider"]').length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  if (!tables.length) { console.warn('Ingen resultattabel fundet — kopiér denne besked til Claude.'); return; }
  const table = tables[0].t;

  const DNF_TOKENS = /^(DNF|DNS|OTL|DSQ|NR|DF|HD|AB)\b/i;
  let pos = 0;
  const results = [...table.querySelectorAll('tbody tr')].map((tr) => {
    const riderA = tr.querySelector('a[href*="rider"]');
    if (!riderA) return null;
    const teamA = tr.querySelector('a[href*="team"]');
    const lead = (tr.children[0]?.innerText || '').trim();
    let rank = /^\d+$/.test(lead) ? +lead : null;
    // status = ægte DNF-token hvis første celle er sådan en; ellers 'OK'
    const leadTok = (lead.match(DNF_TOKENS) || [])[0];
    const status = rank != null ? 'OK' : (leadTok ? leadTok.toUpperCase() : 'OK');
    pos += 1; // 1-baseret rækkefølge (mål-orden) — kun brugt som fallback
    const href = riderA.getAttribute('href') || '';
    const slug = (href.split(/rider\/?/)[1] || '').split(/[/?#&]/)[0];
    return {
      rank, status,
      pos: status === 'OK' ? pos : null, // rækkefølge for finishers (fallback-kilde)
      riderSlug: slug,
      riderName: riderA.innerText.trim(),
      team: teamA ? teamA.innerText.trim() : null,
    };
  }).filter(Boolean);

  // POSITION-FALLBACK: har (næsten) ingen rækker en rang, men der er mange
  // finishers i rækkefølge (TTT), så udled rang af pos. Ægte DNF-rækker forbliver
  // rank=null. Normale etaper (hvor rang-kolonnen findes) rammer ikke dette.
  const withRank = results.filter((r) => r.rank != null).length;
  const finishers = results.filter((r) => r.status === 'OK').length;
  let rankSource = 'kolonne';
  if (withRank < finishers * 0.5 && finishers >= 20) {
    for (const r of results) r.rank = r.status === 'OK' ? r.pos : null;
    rankSource = 'position (TTT-fallback)';
  }
  for (const r of results) delete r.pos;

  // --- stage difficulty (best-effort; PCS markup varies) -------------------
  const pageText = document.body.innerText.replace(/ /g, ' ');
  const num = (re) => { const x = pageText.match(re); return x ? +x[1].replace(/[^\d]/g, '') : null; };
  const dist = (document.title.match(/\(([\d.]+)\s*km\)/) || [])[1]
    || (pageText.match(/Distance:?\s*([\d.]+)\s*km/i) || [])[1];
  const profileScore = num(/ProfileScore\s*:?\s*(\d+)/i);
  const profileScoreFinal = num(/ProfileScore\s*(?:final|finale|last)\b[^\d]*(\d+)/i);
  const verticalM = num(/(?:Vertical\s*met(?:er|re)s?|Elevation\s*gain)\s*:?\s*([\d.,]+)\s*m?/i);

  const out = {
    race,
    stage: { stageNo, distanceKm: dist ? +dist : null, verticalM, profileScore, profileScoreFinal },
    results,
    sourceUrl: location.href,
    capturedAt: new Date().toISOString(),
  };
  copy(JSON.stringify(out, null, 2));
  console.log(`PCS: ${results.length} resultater (${race.slug ?? '?'} ${race.year ?? '?'}, etape ${stageNo ?? '?'}), rang-kilde: ${rankSource}. `
    + `Vinder: ${results.find((r) => r.rank === 1)?.riderName ?? '?'}. `
    + `ProfileScore=${profileScore ?? '?'} final=${profileScoreFinal ?? '?'} vert=${verticalM ?? '?'}m. `
    + `Ser antal/vinder forkert ud? Send konsol-linjen til Claude.`);
})();
