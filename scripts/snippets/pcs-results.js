// scripts/snippets/pcs-results.js (v7.2)
// Kør i browser-konsollen på en PCS etape-resultatside.
// Håndterer både /race/{slug}/{år}/stage-N og race.php?id1=...-URL-formaterne.
//
// v7.2 (GC-fangst rettet): v7's 'Prev'-heuristik fangede den FORKERTE tabel
// (E8 grøn-trøje-stilling: Merlier/Girmay/Kooij; E9 udbryder-orden = selve
// etaperesultatet) → forkert GC-indkomst i fladen (Johannessen 90k, Pogačar 0).
// Nu hentes GC KUN fra den kanoniske .../stage-N-gc-side, og en fangst afvises
// hvis dens top-3 = etaperesultatets top-3. buildWeb har desuden en
// plausibilitets-gate (afviser urealistisk GC-leder). copy() fanges før await.
// v5: etaperesultat = FØRSTE store tabel (≥20 rytter-links) uden 'Prev'.
// v4: position-fallback for rang på TTT-sider. v3: distance/vert/ProfileScore.
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

  // GC-FANGST (v7.2): v7 fangede den FORKERTE tabel (E8 grøn-trøje-stilling,
  // E9 udbryder-orden = etaperesultatet) → forkert GC-indkomst i fladen. Nu:
  // hent KUN fra den kanoniske GC-side (.../stage-N-gc) — dropper den flakse
  // 'Prev'-heuristik på etapesiden — OG afvis en fangst, hvis dens top-3 er
  // identisk med etaperesultatets top-3 (så er det ikke GC, men resultatet).
  // Endelig sanity-check laver buildWeb (afviser urealistisk GC-leder).
  // textContent (ikke innerText): DOMParser-dokumenter har intet layout.
  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, '').split(/\s+/).filter(Boolean).sort().join(' ');
  const resultTop3 = results.filter((r) => r.rank != null).sort((a, b) => a.rank - b.rank).slice(0, 3).map((r) => norm(r.riderName));
  let gc = null, gcSource = 'IKKE hentet';
  if (race.slug && race.year && stageNo != null && stageNo > 0) {
    try {
      const resp = await fetch(`/race/${race.slug}/${race.year}/stage-${stageNo}-gc`);
      if (resp.ok) {
        const doc = new DOMParser().parseFromString(await resp.text(), 'text/html');
        const cand = [...doc.querySelectorAll('table')].find((t) => t.querySelectorAll('a[href*="rider"]').length >= 20);
        if (cand) {
          const g = [...cand.querySelectorAll('tbody tr')].map((tr) => {
            const a = tr.querySelector('a[href*="rider"]');
            const lead = ((tr.children[0] || {}).textContent || '').trim();
            return a && /^\d+$/.test(lead) ? { rank: +lead, name: (a.textContent || '').trim() } : null;
          }).filter(Boolean).filter((x) => x.rank <= 10);
          const gcTop3 = g.slice(0, 3).map((x) => norm(x.name));
          const mirrorsResult = resultTop3.length === 3 && gcTop3.length === 3 && gcTop3.every((x, i) => x === resultTop3[i]);
          if (g.length && !mirrorsResult) { gc = g; gcSource = `stage-${stageNo}-gc-siden`; }
          else if (mirrorsResult) gcSource = `AFVIST (stage-${stageNo}-gc-tabel = etaperesultatet, ikke GC)`;
        }
      } else gcSource = `GC-side svarede ${resp.status}`;
    } catch (e) { gcSource = 'GC-hentning fejlede (' + (e && e.message || e) + ')'; }
  }

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
