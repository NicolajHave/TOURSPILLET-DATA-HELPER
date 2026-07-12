// scripts/snippets/pcs-results.js (v7)
// Kør i browser-konsollen på en PCS etape-resultatside.
// Håndterer både /race/{slug}/{år}/stage-N og race.php?id1=...-URL-formaterne.
//
// v7 (GC-fangst der VIRKER): v6's 'Prev'-detektor fandt aldrig GC-tabellen på
// E7/E8 (PCS's GC-header indeholder åbenbart ikke 'Prev' som antaget). Nu:
// findes ingen Prev-tabel på siden, HENTES .../stage-N-gc-siden direkte (sker
// i din browser, samme origin — PCS's datacenter-blokering rammer ikke), og
// første store rytter-tabel dér ER den samlede stilling. Konsollen viser
// GC-kilden — tjek at GC-toppen ser rigtig ud før upload!
// v5-heuristik bevaret: etaperesultat = FØRSTE store tabel (≥20 rytter-links)
// uden 'Prev'. v4: position-fallback for rang på TTT-sider.
// v3: distance/vert/ProfileScore.
(async () => {
  // DevTools' copy() findes KUN i det synkrone konsol-scope — efter et await
  // er navnet væk (v7-bug: "copy is not defined"). Fang referencen NU; selve
  // funktionsobjektet virker stadig efter await. Clipboard-API som fallback.
  const copyFn = typeof copy === 'function' ? copy : null;
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

  // GC-FANGST (v7): (a) 'Prev'-tabel på samme side hvis den findes; (b) ellers
  // hentes den dedikerede GC-side (.../stage-N-gc) og parses — første store
  // rytter-tabel DÉR er den samlede stilling. textContent (ikke innerText):
  // DOMParser-dokumenter har intet layout, så innerText er tom dér.
  const parseGcRows = (tbl) => [...tbl.querySelectorAll('tbody tr')].map((tr) => {
    const a = tr.querySelector('a[href*="rider"]');
    const lead = ((tr.children[0] || {}).textContent || '').trim();
    return a && /^\d+$/.test(lead) ? { rank: +lead, name: (a.textContent || '').trim() } : null;
  }).filter(Boolean).filter((g) => g.rank <= 10);
  let gc = null, gcSource = 'IKKE fundet (GC-kanal falder tilbage til model)';
  const gcTable = big.find((x) => isStanding(x));
  if (gcTable) {
    const g = parseGcRows(gcTable.t);
    if (g.length) { gc = g; gcSource = 'samme side (Prev-tabel)'; }
  }
  if (!gc && race.slug && race.year && stageNo != null && stageNo > 0) {
    try {
      const resp = await fetch(`/race/${race.slug}/${race.year}/stage-${stageNo}-gc`);
      if (resp.ok) {
        const doc = new DOMParser().parseFromString(await resp.text(), 'text/html');
        const cand = [...doc.querySelectorAll('table')].find((t) => t.querySelectorAll('a[href*="rider"]').length >= 20);
        if (cand) { const g = parseGcRows(cand); if (g.length) { gc = g; gcSource = `hentet fra stage-${stageNo}-gc-siden`; } }
      }
    } catch (e) { /* gc forbliver null — kilden viser det */ }
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
  const json = JSON.stringify(out, null, 2);
  let copied = 'kopieret til udklipsholder ✓';
  if (copyFn) copyFn(json);
  else {
    try { await navigator.clipboard.writeText(json); }
    catch (e) { console.log(json); copied = '⚠ AUTOKOPI FEJLEDE — markér og kopiér JSON\'en printet ovenfor'; }
  }
  const top3 = results.filter((r) => r.rank != null).sort((a, b) => a.rank - b.rank).slice(0, 3)
    .map((r) => `${r.rank}. ${r.riderName}`).join(' · ');
  console.log(`PCS: ${results.length} resultater (${race.slug ?? '?'} ${race.year ?? '?'}, etape ${stageNo ?? '?'}) — ${copied}. Rang-kilde: ${rankSource}. `
    + `${tableNote}. TOP-3: ${top3}. `
    + `GC [${gcSource}]: ${gc ? gc.slice(0, 3).map((g) => `${g.rank}. ${g.name}`).join(' · ') : '—'}. `
    + `ProfileScore=${profileScore ?? '?'} final=${profileScoreFinal ?? '?'} vert=${verticalM ?? '?'}m. `
    + `Er top-3 IKKE etapens podium (fx samlet stilling i stedet)? Send konsol-linjen til Claude.`);
})();
