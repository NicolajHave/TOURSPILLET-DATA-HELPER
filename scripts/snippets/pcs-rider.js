// scripts/snippets/pcs-rider.js (v1)
// Kør i browser-konsollen på en PCS RYTTERSIDE, fx (filtrér gerne til sæsonen):
//   https://www.procyclingstats.com/rider/tadej-pogacar/2026
// Én rytterside = hele sæsonens resultater → form-bredde til EV-modellen.
//
// VIGTIGT (samme klasse fejl som pcs-results v1): race/stageNo må IKKE læses fra
// side-URL'en (den er /rider/{slug}). Hver resultat-RÆKKE har sin egen race-link,
// så vi parser race/år/etape PER RÆKKE. Side-URL'en giver kun rytter-slug.
//
// SMOKE-TEST FØRST: kør på ÉN rytter, gem filen, og send de første ~10 resultater
// til Claude FØR du kører hele startlisten — så vi ikke gentager en parse-fejl 191
// gange. Gem som: fixtures/riders/rider-{slug}.json
(() => {
  // rider slug + name from the PAGE url/title
  const rm = location.pathname.match(/rider\/([^/?#]+)/);
  const riderSlug = rm ? rm[1] : null;
  const riderName = (document.querySelector('h1')?.innerText || '').replace(/\s+/g, ' ').trim();

  // parse a per-row race link -> { raceSlug, year, stageNo }
  const parseRace = (href) => {
    const m = (href || '').match(/race\/([^/?#]+)\/(\d{4})(?:\/stage-(\d+)|\/(prologue))?/);
    return m ? { raceSlug: m[1], year: +m[2], stageNo: m[4] ? 0 : (m[3] ? +m[3] : null) } : null;
  };
  const DATE = /\b(\d{4}-\d{2}-\d{2})\b/;                 // PCS rider results use ISO dates
  const STATUS = /^(DNF|DNS|DNQ|OTL|DSQ|NR|DF)$/i;

  // the results table = the one whose rows link to /race/
  const table = [...document.querySelectorAll('table')].find((t) => t.querySelector('a[href*="/race/"]'));
  if (!table) { console.warn('Ingen resultattabel fundet på ryttersiden — kopiér denne besked + en Inspect af én række til Claude.'); return; }

  const results = [...table.querySelectorAll('tbody tr')].map((tr) => {
    const raceA = tr.querySelector('a[href*="/race/"]');
    if (!raceA) return null;
    const race = parseRace(raceA.getAttribute('href') || '');
    const cells = [...tr.children].map((c) => (c.innerText || '').trim());
    const rowText = cells.join(' | ');
    const date = (rowText.match(DATE) || [])[1] || null;
    // rank = first standalone integer 1..400 that isn't the year and isn't a distance (km/decimal)
    let rank = null, status = 'OK';
    for (const c of cells) {
      if (STATUS.test(c)) { status = c.toUpperCase(); rank = null; break; }
      if (/^\d{1,3}$/.test(c)) { const v = +c; if (v >= 1 && v <= 400) { rank = v; break; } }
    }
    if (rank === null && status === 'OK') status = 'NR';
    const distM = rowText.match(/([\d]+(?:\.\d+)?)\s*km/i);
    return {
      date, rank, status,
      raceSlug: race?.raceSlug ?? null, year: race?.year ?? null, stageNo: race?.stageNo ?? null,
      raceName: raceA.innerText.trim(),
      distanceKm: distM ? +distM[1] : null,
    };
  }).filter(Boolean).filter((r) => r.raceSlug); // keep only rows tied to a real race

  const out = { rider: { slug: riderSlug, name: riderName }, results, sourceUrl: location.href, capturedAt: new Date().toISOString() };
  copy(JSON.stringify(out, null, 2));
  console.log(`PCS rytter: ${riderName || riderSlug} — ${results.length} resultater kopieret. Gem som fixtures/riders/rider-${riderSlug}.json`);
  console.log('SMOKE-TEST: send de første ~10 resultater til Claude FØR du kører hele startlisten.');
  console.table(results.slice(0, 12).map((r) => ({ date: r.date, rank: r.rank, status: r.status, race: r.raceSlug, stage: r.stageNo })));
})();
