// scripts/snippets/pcs-results.js (v6)
// Kør i browser-konsollen på en PCS etape-resultatside.
// Håndterer både /race/{slug}/{år}/stage-N og race.php?id1=...-URL-formaterne.
//
// v6 (GC-fangst): udover etaperesultatet fanges nu OGSÅ den samlede stilling
// (top-10) fra 'Prev'-tabellen → felt "gc" i output. buildWeb lægger den i
// form-snapshottet, så værktøjets GC-indkomst/dag bliver DETERMINISTISK
// (ægte stilling × officiel tabel) i stedet for model-sandsynligheder.
// v5-heuristik bevaret: etaperesultat = FØRSTE store tabel (≥20 rytter-links)
// UDEN 'Prev'-kolonne; GC = første store tabel MED 'Prev'. Konsollen viser
// valgt tabel + top-3 + GC-toppen — TJEK ALTID dén linje før upload!
// v4: position-fallback for rang på TTT-sider. v3: distance/vert/ProfileScore.
(() => {
  const src = location.pathname + location.search;
  const m = src.match(/race(?:\.php)?\/([^/?&]+)\/(\d{4})\/(?:stage-(\d+)|(prologue))/)
         || src.match(/id1=([^&]+)&id2=(\d{4})&id3=stage-(\d+)/);
  const race = m ? { slug: m[1], year: +m[2] } : { slug: null, year: null };
  const stageNo = m ? (m[4] ? 0 : m[3] ? +m[3] : null) : null;

  // Tabelvalg (v5): STORE tabeller = ≥20 rytter-links OG ≥halvdelen af den
  // største (filtrerer TTT-hold-undertabeller à 8 fra). Blandt dem: den FØRSTE
  // i dokument-orden uden 'Prev'-kolonne i headeren — 'Prev' er GC-/stillings-
  // kendetegnet på PCS, og etaperesultatet står før stillingerne i DOM'en.
  const all = [...document.querySelectorAll('table')]
    .map((t, i) => ({
      t, i,
      n: t.querySelectorAll('a[href*="rider"]').length,
      head: ((t.querySelector('thead') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
    }))
    .filter((x) => x.n > 0);
  if (!all.length) { console.warn('Ingen resultattabel fundet — kopiér denne besked til Claude.'); return; }
  const maxN = Math.max(...all.map((x) => x.n));
  const big = all.filter((x) => x.n >= Math.min(20, maxN) && x.n >= maxN * 0.5);
  const isStanding = (x) => /\bPrev\b/i.test(x.head);
  const pick = big.find((x) => !isStanding(x)) || big[0];
  const table = pick.t;
  const tableNote = `tabel #${pick.i} [${pick.head.slice(0, 50) || 'uden header'}] valgt blandt ${big.length} store` +
    (big.some((x) => x !== pick && !isStanding(x)) ? ' ⚠ FLERE ikke-GC-kandidater — verificér top-3!' : '');

  // GC-FANGST (v6): første store tabel MED 'Prev' = den samlede stilling.
  let gc = null;
  const gcTable = big.find((x) => isStanding(x));
  if (gcTable) {
    gc = [...gcTable.t.querySelectorAll('tbody tr')].map((tr) => {
      const a = tr.querySelector('a[href*="rider"]');
      const lead = (tr.children[0]?.innerText || '').trim();
      return a && /^\d+$/.test(lead) ? { rank: +lead, name: a.innerText.trim() } : null;
    }).filter(Boolean).filter((g) => g.rank <= 10);
    if (!gc.length) gc = null;
  }

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
    gc, // samlet stilling top-10 (null hvis GC-tabellen ikke fandtes på siden)
    sourceUrl: location.href,
    capturedAt: new Date().toISOString(),
  };
  copy(JSON.stringify(out, null, 2));
  const top3 = results.filter((r) => r.rank != null).sort((a, b) => a.rank - b.rank).slice(0, 3)
    .map((r) => `${r.rank}. ${r.riderName}`).join(' · ');
  console.log(`PCS: ${results.length} resultater (${race.slug ?? '?'} ${race.year ?? '?'}, etape ${stageNo ?? '?'}), rang-kilde: ${rankSource}. `
    + `${tableNote}. TOP-3: ${top3}. `
    + `GC: ${gc ? gc.slice(0, 3).map((g) => `${g.rank}. ${g.name}`).join(' · ') : 'IKKE fundet (GC-kanal falder tilbage til model)'}. `
    + `ProfileScore=${profileScore ?? '?'} final=${profileScoreFinal ?? '?'} vert=${verticalM ?? '?'}m. `
    + `Er top-3 IKKE etapens podium (fx samlet stilling i stedet)? Send konsol-linjen til Claude.`);
})();
