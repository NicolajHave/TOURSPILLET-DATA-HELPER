# Tourspillet Data Helper — Handover til Claude Code (v2, 9. juni 2026)

Selvstændig brief. Læs denne før du rører kode. Projektet er et datadrevet
beslutningsværktøj til **holdet.dk Tourspillet** (fantasy-cykling, Tour de France
2026), bygget af Nicolaj.

> **v2-ændringer:** Revideret prioriteringsrækkefølge (Dauphiné-snapshots er nu
> opgave #1 — tidskritisk, udløber 14/6), backtest-design opgraderet til
> kalibrering/holdout/out-of-sample, leverage-model opgraderet til faseinddelt
> med EV-gulv og team-stacking.

---

## 0. AKUT (gælder til og med 14. juni 2026)

**Dauphiné-spillet (game 622) kører NU** — løbet hedder i 2026 "Tour
Auvergne-Rhône-Alpes" (omdøbt Critérium du Dauphiné), 7.-14. juni, 8 etaper.
Hverken Pogačar eller Vingegaard deltager.

Hver aften efter etapen: kør holdet-snapshot-snippet og gem JSON som
`fixtures/holdet/dauphine-2026-after-stage-{n}.json`.

Hvorfor det trumfer alt andet:
1. **Værdiformlen** (placering → Δpris) ligger IKKE i ruleset-API'et. Daglige
   snapshots giver datapunkter til at regressere den empirisk — under de
   faktiske 2026-regler. Det er backtestens hårde afhængighed.
2. **Ægte out-of-sample:** de sidste etaper kan paper-trades live.
3. Data forsvinder/fryser når løbet slutter søndag 14/6.

## 1. Mål og strategisk ramme

- **Objektiv:** absolut **førsteplads blandt alle ~30.000+ managere** — ikke
  miniliga.
- Det ændrer alt: vi bygger en **leverage/variance-optimizer**, ikke en
  forventet-værdi-maksimerer. Ren EV konvergerer mod chalk (Pogačar/Vingegaard)
  som alle ejer → kan per definition ikke vinde feltet. Tankegang = DFS GPP
  (tournament), ikke cash.
- Spilleren har **guldhold = fri handel**, MEN der er **1 % købsgebyr** på hver
  rytter man køber → en rytter skal stige > 1 % for at et endags-køb er rentabelt.
- Værktøjet skal tænke **kort sigt** (daglig kaptajn + trades) og **langt sigt**
  (rute i blokke, ride value-stigere, sælg på top, maksimal leverage i uge 3 med
  dobbelt Alpe d'Huez hvor turneringen afgøres).

## 2. Leverage-modellen (v2 — VIGTIGE RETTELSER)

Den naive `EV × (1 − ownership)` per rytter er for primitiv. Tre rettelser:

1. **EV-gulv:** en rytter med ~0 % ejerandel og mikroskopisk EV må ikke outranke
   en solid pick. Leverage-score gælder kun kandidater over en minimums-EV
   (parameter, kalibreres).
2. **Faseinddelt leverage (portefølje-egenskab, ikke per-pick):**
   - Uge 1: lav leverage — byg værdi sikkert, vær chalk hvor udfald er
     forudsigelige (kaptajn).
   - Udbruds-/transitionsetaper: medium-høj leverage (høj varians = kontrær zone).
   - Uge 3 (dobbelt Alpe d'Huez): maksimal leverage — det er her feltet skal slås.
   Princip: chalk hvor forudsigeligt, kontrær hvor varians er høj.
3. **Team-stacking / korrelation:** holdbonus (~60k til alle aktive ryttere fra
   etapevinderens hold) gør ejerskab af 2 ryttere fra et stage-winning team til
   korreleret upside (jf. QB+WR-stacks i DFS). Skal ind i optimeringen.
   Husk constraint: max 2 ryttere per rigtigt hold.

**Kendt begrænsning:** `popularity` måler hele feltet, men den reelle konkurrent
er toppen af leaderboardet, hvis ejerskab afviger fra gennemsnittet. Kan ikke
observeres direkte — betyder at leverage mod feltgennemsnit overvurderer reel
leverage mod toppen. Notér, kompensér ikke naivt.

## 3. Validerings-design (v2 — anti-overfitting)

- **TdF 2025 = kalibrering** (justér half-lives, EV-gulv, vægte her)
- **Vuelta 2025 = holdout** (parametre låst, mål kun)
- **Dauphiné 2026 live = ægte out-of-sample** (paper-trade)
- Baselines at slå: (a) fast chalk-hold, (b) tilfældig kaptajn, (c) altid
  GC-favorit som kaptajn.
- Hvis strategien kun virker på kalibreringsløbet → revidér FØR Touren.

## 4. Stack & hvor tingene er

- **Alt i TypeScript** (ét sprog, kører på Vercel; matcher Windows-arbejdsmaskine
  med install-restriktioner).
- Repo: `https://github.com/NicolajHave/TOURSPILLET-DATA-HELPER`
- Supabase: projekt **loge19**, id `aypygqcwycpufpwqtxnl`, eu-central-1.
  Alle tabeller i isoleret schema **`tourspillet`** (ikke `public`).
- Hemmeligheder i `.env.local` (gitignored). `service_role` kun server-side/
  lokale scripts. Commit aldrig nøgler.
- Validering: `npm run prove` (holdet) og `npm run prove:slice1` (klassifikator+form).

## 5. Datakilder (præcise endpoints + nøglefakta)

**Holdet** — ét request giver alt:
```
GET https://nexus-app-fantasy.holdet.dk/api/games/{gameId}/players
```
- `items[]`: `id` (player), `personId` (rytter), `teamId`, `positionId`,
  `startPrice`, `price`, `points`, `popularity` (ejerandel 0..1), `isOut`.
- `_embedded.persons|teams|positions`: ID → navn/hold/kategori.
- Dauphiné 2026: `gameId=622`, `editionId=357`. **Tour 2026 får ANDET gameId** —
  find via `/api/cartridges/tour-de-france-2026` eller Network-fanen ved åbning.
- Regler: `GET /api/cartridges/{slug}` → `_embedded.rulesets`:
  `transferFee 0.01`, `interestRate 0.005`, `salaryCap 50_000_000`,
  `captainBonusAssets 1`, `captainBonusPoints 0`. Dauphiné-ruleset id 117
  ("Cycling Trading 8 Riders"). **Tour får nyt ruleset-id — verificér.**
- Transport: browser-snippet i indlogget session, én gang dagligt (værdier
  opdateres kun per runde efter verifikation). Ingen server-cron mod holdet.

**PCS (ProcyclingStats)** — resultater + etapeprofiler.
- **PCS BLOKERER datacenter-kald.** Vercel-cron mod PCS vil fejle.
- **Solution A:** browser-snippet læser DOM → JSON → `fixtures/pcs/` →
  `npm run ingest:pcs`. Guide: `docs/PCS_BACKFILL.md`.
- URL-mønster: `/race/{slug}/{year}/stage-{n}/result/result`; oversigt
  `/race/{slug}/{year}/stages`.
- **Scope-disciplin:** backfill kun Tour-relevante ryttere/løb (~80 mand er nok),
  ikke hele pelotonen. Bedre et groft værktøj i brug end en elegant model der
  bliver færdig til etape 14.

## 6. Hvad er bygget (testet hvor muligt)

- `src/lib/ruleset.ts` — regelmotor: `buyFee`, `buyAndHoldNet`, `breakEvenRise`,
  `captainBonus`, `interest`, `leverageScore` (v1 — skal opgraderes jf. §2).
- `src/lib/parseSnapshot.ts` — holdet `/players` → riders/teams/game_players/snapshots.
- `src/lib/stageProfile.ts` — `classifyStage()` (sprint/punch/break/mountain/itt/ttt)
  + `archetypeWeights()`. 7/7 på testtilfælde. Degraderer pænt (ikon →
  ProfileScore → højdemeter).
- `src/lib/form.ts` — `form()` (half-life 30d) + `profileFit()` (120d).
  **No-lookahead indbygget** (ignorerer fremtidsdaterede resultater).
- `src/lib/parsePcsExport.ts` — PCS-snippet-output → DB-rækker + klassifikation.
- `scripts/snippets/pcs-results.js`, `pcs-stages.js` — defensive DOM-læsere.
  **Ikke kørt mod live PCS endnu** — kan kræve selektor-justering første gang.
- `scripts/ingestPcs.ts` — lokal idempotent ingest af `fixtures/pcs/`.

## 7. Databaseskema (`tourspillet`, 11 tabeller)

- Holdet-side: `teams`, `riders` (global, `personId`), `games`, `game_players`,
  `rounds` (`close_at` = transfer-deadline), `snapshots` (daglig tidsserie),
  `my_squad`.
- PCS-side: `races`, `race_stages` (features + `profile`), `results`
  (`pcs_rider_slug` + `rank`/`status`), `rider_links` (pcs_slug → rider_id).

## 8. REVIDERET roadmap (prioriteret)

1. **[NU — dagligt til 14/6]** Holdet-snapshots af game 622 efter hver etape.
2. **[✓ GJORT — se `docs/VALUE_FORMULA.md`]** Værdiformel-inferens: join snapshots
   (Δpris per rytter per runde) med PCS-resultater for samme etape → regressér
   placering/status → Δværdi. Inkl. holdbonus- og trøje-effekter hvis
   identificerbare. **Resultat:** additiv, deterministisk formel —
   `Δpris = baseline(etapetype) + placeringspræmie(rank) + 60.000·[vinderhold]
   + trøjebonus − 100.000·[DNF]`. Holdbonus (+60k) og DNF (−100k) er knivskarpe.
   Kør `npx tsx scripts/inferValueFormula.ts`; koeff. i `artifacts/value-formula.json`.
3. **[Parallelt]** Paper-trade beslutningsloopet på Dauphinés sidste etaper.
4. **[Derefter]** PCS-backfill TdF 2025 (kalibrering) + Vuelta 2025 (holdout) →
   backtest-motor jf. §3.
5. **[Sidst]** Leverage v2 (§2), team-stacking, slice 2 (schedule/deadlines),
   slice 3 (daglig import-side/UI).
6. **[Ved Tour-åbning ~juli]** Nyt gameId/ruleset verificeres; skift game.

## 9. Constraints & gotchas

- PCS blokerer bots → kun browser-snippet. Holdet: ingen offentlig API → snippet.
- 1 % købsgebyr + 0,5 % rente skal altid med i trade-/likviditetslogik.
- Kaptajnsmekanik (positiv værdistigning udbetalt til bank) er **inferred** —
  verificér empirisk mod Dauphiné-snapshots.
- Holdbonus ~60k → team-stacking har skjult værdi (§2.3).
- PCS↔holdet identitet: navn/slug vs. `personId` → `rider_links`, auto-match på
  navn, manuel rettelse af afvigere.
- No-lookahead i ALT historik-baseret feature-arbejde.
- Commit aldrig hemmeligheder.

## 10. Åbne beslutninger / parametre at bekræfte

- ~~Empirisk værdiformel (fra Dauphiné-snapshots — opgave #2).~~ ✓ inferred, se
  `docs/VALUE_FORMULA.md`. Forbehold: placeringspræmiens eksakte funktionsform og
  trøje-vs-udbruds-skel bør re-kalibreres på TdF 2025.
- Eksakt 2026-Tour-ruleset (id + tabel) ved spilåbning.
- Tour 2026 `gameId` / `editionId` / cartridge-slug.
- Kaptajnsbonus-formel (verificér mod snapshots).
- Half-lives (30d/120d), EV-gulv, fase-vægte → kalibreres jf. §3.

## 11. Arbejdskonventioner (spillerens præferencer)

- Svar på **dansk** som standard; engelsk når det skal præsenteres/videregives.
- Direkte, uformelt-professionelt, handlingsorienteret, teoretisk fundament når
  relevant. Minimal humor.
- Fungér som **sparringspartner**: udfordr antagelser, påpeg bekræftelsesbias,
  ret fejl tydeligt med forklaring. Ikke bare bekræfte.
- MVP-disciplin: validér før UI. Groft-i-brug slår elegant-for-sent.
- Selected skrives altid med stort S kun.
