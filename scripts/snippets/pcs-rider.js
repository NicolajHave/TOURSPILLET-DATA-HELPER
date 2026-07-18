// scripts/snippets/pcs-rider.js (v3.1)
// v3.1: JSON lander nu OGSÅ i udklipsholderen (copy fanget før await — samme
// fix som pcs-results v7.1); fødselsår-parseren gjort robust (Arensman gav
// "f. ?" — nu tages første årstal inden for 40 tegn efter "Date of birth").
// Kør på en PCS RYTTER-RESULTATSIDE filtreret til sæsonen, fx:
//   …/rider/tadej-pogacar  →  fanen Results  →  vælg 2026
//   (URL kan være rider.php?id=…&p=results&xseason=2026 — slug er IKKE i URL'en)
//
// v3 (SPECIALTIES + fysik): fanger nu OGSÅ rytterens PCS-profil — Specialties-
// point (Onedayraces/GC/TT/Sprint/Climber/Hills), vægt, højde, fødselsår.
// Ligger Info-boksen ikke i den aktuelle visning (Results-fanen), hentes
// rytterens forside (/rider/{slug}) automatisk og parses (samme origin).
// buildWeb bruger point-fordelingen som RYTTERTYPE-PRIOR (fx Tejada: Climber
// 1274 vs Sprint 12 → renheds-dæmpningen får et langt renere signal end
// vores rank-baserede fits). Re-scrape midt i Touren er sikkert: buildWeb
// ignorerer tour-de-france-2026-rækker fra rytterfiler (kommer fra
// etape-filerne — ingen dobbelttælling).
// v2-features bevaret: kolonne-mapping via overskrifter, race/år/etape pr.
// række, KMs+Vert til fallback-klassifikation, classification-markering.
//
// Gem som: fixtures/riders/rider-{slug}.json (overskriv gerne den gamle)
(async () => {
  // v3.1: DevTools' copy() findes kun synkront — fang referencen FØR await
  // (samme fix som pcs-results v7.1), så JSON'en også lander i udklipsholderen.
  const copyFn = typeof copy === 'function' ? copy : null;
  const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const pm = location.pathname.match(/rider\/([^/?#]+)/);
  const riderName = (document.querySelector('h1')?.innerText || '').replace(/\s+/g, ' ').trim();
  const riderSlug = pm ? pm[1] : slugify(riderName);

  // find the results table: a table.basic whose header has Date + Race (+ Result)
  const tables = [...document.querySelectorAll('table')];
  const headerText = (t) => (t.querySelector('tr')?.innerText || '').toLowerCase();
  const table = tables.find((t) => /date/.test(headerText(t)) && /race/.test(headerText(t)) && t.querySelector('a[href*="race/"]'))
    || tables.find((t) => t.querySelector('a[href*="race/"]'));
  if (!table) { console.warn('Ingen resultattabel fundet — kopiér Inspect af tabellen til Claude.'); return; }

  // map columns by header label
  const heads = [...(table.querySelector('thead tr') || table.querySelector('tr')).children].map((c) => c.innerText.trim().toLowerCase());
  const col = (re, fallback) => { const i = heads.findIndex((h) => re.test(h)); return i >= 0 ? i : fallback; };
  const iDate = col(/date/, 1), iResult = col(/result|rnk|pos/, 2), iKms = col(/km/, 5), iVert = col(/vert/, 8);

  const parseRace = (href) => {
    const m = (href || '').match(/race\/([^/?#]+)\/(\d{4})(?:\/stage-(\d+)|\/(prologue))?/);
    return m ? { raceSlug: m[1], year: +m[2], stageNo: m[4] ? 0 : (m[3] ? +m[3] : null) } : null;
  };
  // KMs use a DOT decimal (150.7) — keep it; strip only thousands commas.
  const kmCell = (cells, i) => { const m = (cells[i] || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : null; };
  // Vert. mtr is integer metres — strip any thousands separator (dot/comma/space).
  const vertCell = (cells, i) => { const m = (cells[i] || '').replace(/[.,\s]/g, '').match(/\d+/); return m ? parseInt(m[0], 10) : null; };
  const STATUS = /^(DNF|DNS|DNQ|OTL|DSQ|NR|DF|HD)$/i;

  const rows = [...table.querySelectorAll('tbody tr')].length ? [...table.querySelectorAll('tbody tr')] : [...table.querySelectorAll('tr')].slice(1);
  const results = rows.map((tr) => {
    const raceA = tr.querySelector('a[href*="race/"]');
    if (!raceA) return null;
    const cells = [...tr.children].map((c) => (c.innerText || '').trim());
    const href = raceA.getAttribute('href') || '';
    const race = parseRace(href);
    const raceName = raceA.innerText.trim();
    const resultCell = cells[iResult] || '';
    let rank = /^\d+$/.test(resultCell) ? +resultCell : null;
    let status = rank != null ? 'OK' : (STATUS.test(resultCell) ? resultCell.toUpperCase() : 'NR');
    // classification = a standings row (KOM/points/GC/youth), not a stage result.
    // Detect from the href suffix (most reliable) OR the link text.
    const isClassification = /\/(kom|points|gc|youth|general|teams|sprint)(\/|$|\?)/i.test(href)
      || /classification|klassement|jersey/i.test(raceName);
    const rowType = isClassification ? 'classification' : (race && race.stageNo != null ? 'stage' : 'oneday');
    const discipline = /\bTTT\b/i.test(raceName) ? 'ttt' : (/\bITT\b|time trial|prologue/i.test(raceName) ? 'itt' : 'road');
    return {
      date: (cells[iDate] || '').match(/\d{4}-\d{2}-\d{2}/)?.[0] || null,
      rank, status, rowType, discipline,
      raceSlug: race?.raceSlug ?? null, year: race?.year ?? null, stageNo: race?.stageNo ?? null,
      raceName,
      distanceKm: kmCell(cells, iKms),
      verticalM: vertCell(cells, iVert),
    };
  }).filter(Boolean).filter((r) => r.raceSlug);

  // SPECIALTIES + fysik (v3): parse fra denne side hvis Info-boksen findes —
  // ellers hentes rytterens forside. Tekst-baseret parsing (tal FØR label:
  // "1274 Climber"), afgrænset til segmentet efter "Specialties" så "GC"
  // ikke rammer tilfældig tekst andetsteds.
  const parseProfile = (text) => {
    const t = (text || '').replace(/\s+/g, ' ');
    const ix = t.search(/Specialt/i);
    const seg = ix >= 0 ? t.slice(ix, ix + 400) : '';
    const num = (label) => { const m = seg.match(new RegExp('(\\d+)\\s*' + label, 'i')); return m ? +m[1] : null; };
    const sp = { oneday: num('One.?day.?races'), gc: num('GC'), tt: num('TT'), sprint: num('Sprint'), climber: num('Climber'), hills: num('Hills') };
    const w = t.match(/Weight:?\s*([\d.]+)\s*kg/i); const h = t.match(/Height:?\s*([\d.]+)\s*m/i);
    // v3.1: fødselsår robust — tag første 4-cifrede tal inden for 40 tegn
    // efter "Date of birth" (formatet varierer: "4th December 1999 (26)" m.fl.)
    const bIx = t.search(/Date of birth/i);
    const b = bIx >= 0 ? t.slice(bIx, bIx + 40).match(/(19|20)\d{2}/) : null;
    return {
      specialties: Object.values(sp).some((v) => v != null) ? sp : null,
      weightKg: w ? +w[1] : null, heightM: h ? +h[1] : null, birthYear: b ? +b[0] : null,
    };
  };
  let profile = parseProfile(document.body.innerText);
  if (!profile.specialties && riderSlug) {
    try {
      const resp = await fetch(`/rider/${riderSlug}`);
      if (resp.ok) {
        const doc = new DOMParser().parseFromString(await resp.text(), 'text/html');
        profile = parseProfile(doc.body ? doc.body.textContent : '');
      }
    } catch (e) { /* profil forbliver tom — konsollen viser det */ }
  }

  const out = { rider: { slug: riderSlug, name: riderName, ...profile }, results, sourceUrl: location.href, capturedAt: new Date().toISOString() };
  const json = JSON.stringify(out, null, 2);
  // Batch-effektivt: fil-download med korrekt navn (rider-{slug}.json — navnet
  // SKAL passe i fixtures/riders/) ... OG i udklipsholderen (v3.1) til hurtig
  // verifikation/paste. Begge dele på én kørsel.
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rider-${riderSlug}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  let copied = 'fil + udklipsholder ✓';
  if (copyFn) copyFn(json);
  else { try { await navigator.clipboard.writeText(json); } catch (e) { copied = 'fil downloadet (udklipsholder fejlede — brug filen)'; } }
  const byType = results.reduce((a, r) => (a[r.rowType] = (a[r.rowType] || 0) + 1, a), {});
  const spTxt = profile.specialties
    ? `Specialties: klatrer ${profile.specialties.climber ?? '?'} · sprint ${profile.specialties.sprint ?? '?'} · hills ${profile.specialties.hills ?? '?'} · GC ${profile.specialties.gc ?? '?'} · TT ${profile.specialties.tt ?? '?'} (${profile.weightKg ?? '?'} kg, f. ${profile.birthYear ?? '?'}) ✓`
    : '⚠ Specialties IKKE fundet — tjek at du er på en rytterside';
  console.log(`PCS rytter: ${riderName} (${riderSlug}) — ${results.length} rækker (${copied}). Typer: ${JSON.stringify(byType)}. ${spTxt}. rider-${riderSlug}.json → fixtures/riders/ (overskriv gerne) og upload.`);
})();
