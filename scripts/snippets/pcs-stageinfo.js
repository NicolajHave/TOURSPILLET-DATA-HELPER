// scripts/snippets/pcs-stageinfo.js (v1)
// Kør på en KOMMENDE etapes side (preview, INGEN resultater endnu), fx:
//   https://www.procyclingstats.com/race/tour-de-france/2026/stage-13
// Henter distance, højdemeter, ProfileScore (+ final) fra infoboksen og downloader
// {slug}-{year}-stage-{n}.json med results:[] — no-result-guarden holder den ude af
// form/ingest, og når etapen er kørt OVERSKRIVER du bare filen med pcs-results.js
// (samme filnavn, fuld data). Arbejdet er altså ikke spildt efter løbsstart.
//
// SMOKE-TEST: kør på ÉN tvetydig etape (fx stage-13) og send output til Claude før
// du tager alle 21.
(() => {
  const m = (location.pathname + location.search)
    .match(/race\/([^/?#]+)\/(\d{4})\/(?:stage-(\d+)|(prologue))/)
    || (location.search.match(/id1=([^&]+)&id2=(\d{4})&id3=stage-(\d+)/));
  if (!m) { console.warn('Kunne ikke læse race/etape fra URL — send URL til Claude.'); return; }
  const race = { slug: m[1], year: +m[2] };
  const stageNo = m[4] ? 0 : +m[3];

  const pageText = document.body.innerText.replace(/ /g, ' ');
  const num = (re) => { const x = pageText.match(re); return x ? +x[1].replace(/[^\d.]/g, '') : null; };
  const dist = (document.title.match(/\(([\d.]+)\s*km\)/) || [])[1]
    || (pageText.match(/Distance:?\s*([\d.]+)\s*km/i) || [])[1];
  const verticalM = num(/(?:Vertical\s*met(?:er|re)s?|Elevation\s*gain)\s*:?\s*([\d.,]+)/i);
  const profileScore = num(/ProfileScore\s*:?\s*(\d+)/i);
  const profileScoreFinal = num(/ProfileScore\s*(?:final|finale|last[^:]*)\s*:?\s*(\d+)/i);
  const dateISO = (pageText.match(/\b(\d{4}-\d{2}-\d{2})\b/) || [])[1] || null;

  const out = {
    race,
    stage: { stageNo, date: dateISO, distanceKm: dist ? +dist : null, verticalM, profileScore, profileScoreFinal },
    results: [],
    note: 'preview (ingen resultater endnu) — overskriv med pcs-results.js efter etapen',
    sourceUrl: location.href,
    capturedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${race.slug}-${race.year}-stage-${stageNo}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  console.log(`Stage-info E${stageNo}: km=${dist ?? '?'} vert=${verticalM ?? '?'} ps=${profileScore ?? '?'} psFinal=${profileScoreFinal ?? '?'} — downloadet.`);
  console.log('Er km/vert "?" → send et udsnit af sidens infoboks til Claude.');
})();
