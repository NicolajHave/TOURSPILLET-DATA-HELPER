# Tour de France 2026 — Åbnings-checkliste

Det her er de sidste skridt, der skal ske, **når holdet åbner Tour-spillet og
startlisten er bekræftet** (sandsynligvis 1.-3. juli; Touren starter lørdag 4.
juli). Indtil da: paper-trade på Dauphiné for at blive fortrolig med fladen.

Rækkefølgen er bevidst — hvert trin afhænger af det foregående.

---

## TRIN 1 — Find Tour-spillets gameId (når holdet åbner spillet)

Værktøjet er kalibreret på Dauphiné (gameId 622). Tour-spillet får et **nyt
gameId**.

1. Log ind på holdet, åbn Tour-spillet.
2. Find gameId via ét af:
   - Adresselinjen: `https://nexus-app-fantasy.holdet.dk/api/cartridges/tour-de-france-2026`
     (slug kan variere — tjek i Network-fanen hvis den fejler)
   - Eller Network-fanen → find kaldet `/api/games/{NYT_ID}/players`
3. **Opdater dit daglige bogmærke** til det nye id:
   `https://nexus-app-fantasy.holdet.dk/api/games/{NYT_ID}/players`

✅ Resultat: du ved hvilket gameId dine daglige Tour-snapshots skal hentes fra.

## TRIN 2 — Verificér Tour-rulesettet (KRITISK)

Værdiformlen er kalibreret på Dauphinés ruleset (id 117). Tour-spillet får et
**nyt ruleset-id**. Hvis reglerne afviger, er formlen forkert, indtil den justeres.

1. Hent `/api/cartridges/tour-de-france-2026` → find `_embedded.rulesets`.
2. Tjek mod de værdier formlen antager:
   - `transferFee` = 0.01 ?
   - `interestRate` = 0.005 ?
   - `salaryCap` = 50.000.000 ?
   - `captainBonusAssets` = 1 ?
   - Holdbonus (~60k) / DNF (−100k) — samme størrelsesorden?
3. Gem cartridge-filen: `fixtures/holdet/tour-de-france-2026-cartridge.json`.

→ **Til Code:** "Verificér Tour 2026-rulesettet mod value-formula. Afviger nogen
konstant fra Dauphiné (ruleset 117), så flag det og justér formlen. Er det samme
familie, bekræft det eksplicit."

⚠️ Spil ikke for alvor før dette er bekræftet. En ændret holdbonus eller pointtabel
ændrer hele leverage-regnestykket.

## TRIN 3 — Hent rytter-sæsondata for den bekræftede startliste

Nu (og først nu) er ryttersiderne relevante — du kender de rigtige ~80 ryttere.

1. Find Tour 2026-startlisten (holdet-spillets rytterliste, eller PCS' startliste).
2. For hver Tour-rytter: kør `pcs-rider.js`-snippet på rytterens PCS-side
   (`/rider/{slug}`) → gem som `fixtures/pcs/rider-{slug}.json`.
   - Det giver hele 2026-sæsonen (Giro, Suisse, klassikere, NM) i ét hug, korrekt
     recency-vægtet af `form.ts`.
   - NB: `pcs-rider.js` har stadig samme URL-svaghed som results-snippet'en havde —
     få Code til at rette `race`/`stageNo`-parsingen først (samme fix som pcs-results v2).

→ **Til Code:** "Ret pcs-rider.js' URL-parsing (samme fix som pcs-results v2), så
race/stageNo ikke bliver null. Jeg henter så ryttersider for hele Tour-startlisten."

✅ Resultat: EV-modellen har frisk form på de faktiske deltagere.

## TRIN 4 — Læg Tour 2026-ruten ind som forudsigelses-mål

Modellen skal kunne klassificere hver Tour-etape for at anbefale dagligt.

1. Tjek først med Code: blev Tour-ruten lagt ind tidligere (race
   `tour-de-france-2026`, 21 etaper i `race_stages`), eller udestår det?
2. Hvis nej: hent `/race/tour-de-france/2026/stages` med `pcs-stages.js` →
   `fixtures/pcs/tour-de-france-2026-stages.json`.
3. Få Code til at klassificere alle 21 og rapportere mærkningen, så du kan
   verificere den mod den kendte rute — særligt uge 3 / dobbelt Alpe d'Huez.

⚠️ GUARDRAIL: Tour-etaperne har ingen resultater endnu. De må ALDRIG indgå i
kalibrering/backtest — kun som anvendelses-mål. (No-result-guarden fanger dem
automatisk, men bekræft det.)

## TRIN 5 — Genbyg fladens data + redeploy

1. Push alt det nye (rytterdata, Tour-rute, evt. justeret formel) til `main`.
2. Vercel auto-redeployer. `scripts/buildWeb.ts` regenererer
   `public/data/form-snapshot.json` med Tour-feltet.
3. Bekræft fladen nu viser Tour-ryttere, ikke Dauphiné-feltet.

## TRIN 6 — Live-test før første etape

1. Hent et rigtigt Tour-snapshot (nyt gameId) → indsæt i fladen.
2. Vælg etape 1's profil (Barcelona, holdtidskørsel-start → tjek profil).
3. Sanity-check anbefalingen: giver kaptajn + leverage-listen mening mod hvad du
   selv ved om favoritterne? Ingen åbenlyse navne-join-fejl?
4. Lav din første rigtige beslutning og **log den** (med ejerandel-ved-beslutning).

---

## Den daglige rutine under Touren (4.-26. juli)

Hver dag, før næste etapes deadline:
1. Hent dagens Tour-snapshot (nyt gameId-bogmærke) → indsæt i fladen.
2. Vælg morgendagens profil → Beregn.
3. Beslut: kaptajn (fra tillid/expectedDelta — IKKE på break/ITT), differentiering
   (fra leverage-listen). Respektér lav-tillid-advarslerne.
4. **Log beslutningen** før etapen + ejerandele.
5. Efter etapen: noter faktisk udfald i loggen.
6. Eksportér loggen som JSON med jævne mellemrum (localStorage kan forsvinde).

## Det loggen skal bevise

Hele paper-trade-formålet: **virker leverage live?** Rykkede dine kontrære valg
dig op mod feltet, eller kostede de bare EV? Det er den eneste validering, der ikke
kunne laves i backtest — og den eneste måde at vide, om kernestrategien holder, før
du satser en hel Tour på den.

## Stadig i kø (lav prioritet, ikke blockers)
- PCS rytter-ranking → ægte markedsværdi-baseline (ærligste edge-test).
- `profileScoreFinal`-fix → renere bjerg-vs-break-klassifikation.
