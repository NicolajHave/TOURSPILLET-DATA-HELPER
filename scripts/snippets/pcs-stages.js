// scripts/snippets/pcs-stages.js (v2 — robust)
// SOLUTION A — run in the console on a PCS race STAGES overview, e.g.
//   https://www.procyclingstats.com/race/tour-de-france/2025/stages
// Grabs distance + parcours type for ALL stages in one go.
//
// v2: does NOT depend on a <table>. PCS moved the overview to a different markup,
// so we locate each stage by its /stage-N link and read the surrounding row.
// If parcoursType is null the classifier still works from vertical/ProfileScore,
// or you can set it by hand for the ~21 stages. Copy console output to Claude if
// rows look wrong.

(() => {
  const path = location.pathname; // /race/{slug}/{year}/stages
  const m = path.match(/\/race\/([^/]+)\/(\d{4})/);
  const race = m ? { slug: m[1], year: +m[2] } : { slug: null, year: null };

  // PCS parcours icon -> our ParcoursType. Icon class is like "icon profile p4".
  const ICON = { p1: 'flat', p2: 'hilly_flat_finish', p3: 'hilly_uphill_finish', p4: 'mountain_flat_finish', p5: 'mountain_summit_finish' };
  const classTokens = (el) => ((el.className && el.className.baseVal) || el.className || '').toString().split(/\s+/);
  const parcoursFrom = (row) => {
    for (const el of row.querySelectorAll('[class]')) {
      for (const t of classTokens(el)) if (ICON[t]) return ICON[t];
    }
    const tagged = row.querySelector('img[alt], [title]');
    const txt = (((tagged && tagged.getAttribute('alt')) || '') + ' ' + ((tagged && tagged.getAttribute('title')) || '')).toLowerCase();
    if (/summit|mountains? finish/.test(txt)) return 'mountain_summit_finish';
    if (/mountain/.test(txt)) return 'mountain_flat_finish';
    if (/hill/.test(txt)) return 'hilly_flat_finish';
    if (/flat/.test(txt)) return 'flat';
    return null;
  };

  // Find every per-stage link and the row that contains it.
  const byStage = new Map(); // stageNo -> rowElement
  for (const a of document.querySelectorAll('a[href*="stage-"]')) {
    const sm = (a.getAttribute('href') || '').match(/stage-(\d+)/);
    if (!sm) continue;
    const no = +sm[1];
    if (no < 1 || no > 30) continue;
    const row = a.closest('tr, li, [class*="row"], [class*="list"]') || a.parentElement;
    if (!row) continue;
    const hasKm = /\d\s*km/i.test(row.innerText);
    if (!byStage.has(no) || (hasKm && !/\d\s*km/i.test(byStage.get(no).innerText))) byStage.set(no, row);
  }

  if (byStage.size === 0) {
    console.warn('Ingen etape-links fundet. Højreklik på én etaperække > Inspect, og kopiér den ydre HTML til Claude.');
    return;
  }

  const stages = [...byStage.entries()].sort((a, b) => a[0] - b[0]).map(([no, row]) => {
    const text = row.innerText.replace(/\n/g, ' ');
    const distM = text.match(/(\d+(?:\.\d+)?)\s*km/i);
    const dateM = text.match(/(\d{1,2}[/.]\d{1,2})/);
    const ttt = /\bTTT\b|team time trial/i.test(text);
    const itt = !ttt && (/\bITT\b|individual time trial|time trial|\(ITT\)/i.test(text));
    return {
      stageNo: no,
      date: dateM ? dateM[1] : null,
      distanceKm: distM ? +distM[1] : null,
      parcoursType: parcoursFrom(row),
      discipline: ttt ? 'ttt' : itt ? 'itt' : 'road',
      verticalM: null,
      profileScore: null,
    };
  });

  const out = { race, stages, sourceUrl: location.href, capturedAt: new Date().toISOString() };
  copy(JSON.stringify(out, null, 2));
  console.log(`PCS: ${stages.length} etaper kopieret (${race.slug} ${race.year}). Gem som fixtures/pcs/${race.slug}-${race.year}-stages.json`);
  console.table(stages.map((s) => ({ stage: s.stageNo, km: s.distanceKm, parcours: s.parcoursType, disc: s.discipline })));
})();
