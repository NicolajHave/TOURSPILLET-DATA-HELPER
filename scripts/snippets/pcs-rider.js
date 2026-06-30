// scripts/snippets/pcs-rider.js (v2)
// Kør på en PCS RYTTER-RESULTATSIDE filtreret til sæsonen, fx:
//   …/rider/tadej-pogacar  →  fanen Results  →  vælg 2026
//   (URL kan være rider.php?id=…&p=results&xseason=2026 — slug er IKKE i URL'en)
//
// v2 (efter DOM-diagnose): tabellen er class="basic" (ikke rdrResults). Kolonner:
//   # | Date | Result | Race | Class | KMs | PCS points | UCI points | Vert. mtr
// Vi mapper kolonner via OVERSKRIFTER (robust mod rækkefølge), parser race/år/etape
// PER RÆKKE fra race-linket, og tager KMs + Vert.mtr med så fallback-klassifikation
// kan bruge klatre-densitet (vert/km), ikke kun distance ("sprint-only"-fælden).
// Klassements-rækker (Mountains/Points/GC classification) markeres rowType:
// 'classification' → de er STANDINGER, ikke etaperesultater (udelades fra form/fit).
//
// SMOKE-TEST: kør på ÉN rytter (Pogačar), send output til Claude FØR alle 191.
// Gem som: fixtures/riders/rider-{slug}.json
(() => {
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

  const out = { rider: { slug: riderSlug, name: riderName }, results, sourceUrl: location.href, capturedAt: new Date().toISOString() };
  // Batch-effektivt: trigger en fil-download med korrekt navn (ingen Notesblok ×191).
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rider-${riderSlug}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  const byType = results.reduce((a, r) => (a[r.rowType] = (a[r.rowType] || 0) + 1, a), {});
  console.log(`PCS rytter: ${riderName} (${riderSlug}) — ${results.length} rækker. Typer: ${JSON.stringify(byType)}. Downloadet som rider-${riderSlug}.json → flyt til fixtures/riders/ og upload.`);
  console.log('SMOKE-TEST: send de første ~12 rækker + typer til Claude FØR du kører hele startlisten.');
  console.table(results.slice(0, 12).map((r) => ({ date: r.date, rank: r.rank, st: r.status, type: r.rowType, race: r.raceSlug, stg: r.stageNo, km: r.distanceKm, vert: r.verticalM })));
})();
