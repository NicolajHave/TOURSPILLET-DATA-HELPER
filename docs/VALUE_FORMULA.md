# Værdiformel-inferens — Dauphiné 2026

Resultat af roadmap-opgave **#2** (HANDOVER §8): empirisk inferens af holdets
skjulte værdiformel (placering → Δpris) på det fulde 8-etapers Dauphiné-datasæt.

Reproducér: `npx tsx scripts/inferValueFormula.ts`
Maskinlæsbare koefficienter: `artifacts/value-formula.json`
Kode: `src/lib/valueFormula.ts` (join/match/stat) + scriptet (dekomposition/rapport).

---

## TL;DR — formlen

Prisændringen pr. rytter pr. runde er **deterministisk og additiv** (ikke
handels-/efterspørgselsdrevet):

```
Δpris  =  baseline(etapetype)
        + placeringspræmie(rank, etapetype)
        + 60.000  · [aktiv rytter på etapevinderens hold]
        + trøjebonus(klassementsledere)
        − 100.000 · [udgået (DNF/DNS)]
```

Alle led er bekræftet på tværs af de rene endags-deltaer. De to mest stabile
koefficienter — **holdbonus = +60.000 kr** og **DNF-straf = −100.000 kr** — har
spredning 0 på de etaper hvor de kan måles rent.

---

## Datagrundlag og tidslinje

`points`-feltet er **0** for hele dette spil ("Cycling Trading 8 Riders"), så
prisen er det eneste observerbare signal. Vi regresserer derfor Δpris direkte på
PCS-placering. Snapshots dækker ikke alle 8 etaper enkeltvis:

| Blok | Før → Efter | Behandling |
|---|---|---|
| **Etape 1** | `startPrice` → HAR-snapshot | Ren endags-delta (hård åbner) |
| **Etape 2+3** | HAR → after-stage-3 | **Samlet** — kan ikke separeres (stage 3 = TTT) |
| **Etape 4–8** | after n−1 → after n | Rene endags-deltaer |

Navnematch holdet (`personId`+navn) ↔ PCS (slug): ~99 % af de aktive ryttere
matches (subset-fallback fanger fx PCS "Cristián Rodríguez" → holdet "Cristian
Rodriguez Martin"). Matchraten pr. etape falder mod slutningen (E8: 65 %) — det
er **reelt frafald** (udgåede ryttere optræder ikke i PCS-resultatet), ikke
match-fejl; de håndteres af DNF-leddet.

---

## Bevis: formel, ikke efterspørgsel

1. **Kvantisering:** 100 % af alle deltaer er hele 1.000-kr-trin, med tydelige
   spidser ved præcis +60.000 og −100.000. En markedsdrevet pris ville give skæve tal.
2. **Invarians:** 8 menige ryttere på vinderholdene (E4–5) fik **alle præcis
   +60.000 kr**, selv om deres ejerandel spændte fra 0,4 % til 12,2 %. Prisen er
   altså uafhængig af handel.
3. Korrelation(ejerandel, Δpris) er positiv (0,3–0,8) — **men confounded**:
   populære ryttere *er* de stærke ryttere. Det er ikke et tegn på handelsdrift.

---

## De enkelte faktorer

### Holdbonus — den klareste effekt
**+60.000 kr** til hver aktiv rytter på etapevinderens (holdet-)hold.
- Flade etaper (E4–5): nøjagtig +60.000, spredning 0 (baseline = 0, så bonussen
  står rent — fx alle Lidl-Trek/Visma-menige).
- Bjergetaper (E6–8): maskeres af negativ baseline, men en **rank-matchet**
  sammenligning (holdkammerat minus jævnbyrdige ikke-vinderhold-ryttere) giver
  stadig 54–74k. Middel over alle etaper: **60.292 kr, CV 11 %**.
- Bonussen **stacker** med trøje-/GC-bonus: Ayuso/Skjelmose/Jorgenson fik
  110–130k = 60k holdbonus + GC-bonus, da deres holdkammerat vandt.
- → Bekræfter HANDOVER §2.3: team-stacking har reel, korreleret upside.

### DNF-straf
Udgåede ryttere (`isOut`) får **−100.000 kr**, spredning 0. (Enkelte −50.000 ved
delvis runde / sent frafald.)

### Baseline (at finde i feltet)
Hvad en menig finisher uden trøje får for bare at gennemføre:
- **Flade etaper: 0 kr** (spredning 0).
- **Bjergetaper: ≈ −67.500 kr** (median; spænd −45k…−90k, CV 19 %). På hårde
  etaper *taber* hele gruppetto'en værdi — det er her placering for alvor betaler.

### Placeringspræmie (Δpris over baseline, renset for holdbonus)

| rank | flad (median) | bjerg (median) |
|---:|---:|---:|
| 1 | 281.000 | 466.250 |
| 2 | 247.500 | 396.500 |
| 3 | 210.000 | 363.000 |
| 5 | 158.000 | 240.500 |
| 10 | 103.500 | 170.000 |

- Monotont faldende med placering; ~0 omkring rank 35–40 på flade etaper.
- **Skala vokser på de afgørende etaper.** Absolutte vinderdeltaer: E4 347k →
  E5 335k → E6 355k → E7 430k → E8 490k. Samme placering er altså mere værd på en
  bjergetape end på en flad — både fordi præmien er større *og* fordi baseline er
  dybt negativ. Det er præcis den dynamik leverage-modellen (HANDOVER §2.2) skal
  udnytte: maksimal indsats i uge 3.
- Stabilitet på tværs af E4–8: **CV ≈ 21–25 %** (drevet af flad-vs-bjerg-skiftet,
  ikke af støj — splittet på etapetype er hver gruppe stram).
- **Etape 1 er entanglet:** vinderen (Baudin) tog samtidig førertrøjen, så hans
  præmie (572k) kan ikke renses for trøjeerobringen. Brug ikke E1-rank-1 som
  ren placeringsdatapunkt.

### Trøje-/leder-bonus
Ryttere der stiger langt mere end deres placering tilsiger (residual over
rank-matchede ligesindede), gentaget på flere etaper:

| Rytter | Median residual | Sandsynlig årsag |
|---|---:|---|
| Alex Baudin | 140.000 | Førertrøje / GC-leder (E4–5, plads 49/66) |
| Kevin Vauquelin | 90.000 | Høj GC / ungdomstrøje |
| Oscar Onley | 80.000 | Høj GC |
| Matteo Jorgenson | 66.250 | GC (Visma) |

**Caveat:** uden faktiske klassements-/trøjestandinger kan metoden ikke skelne
en *trøjebærer* fra en rytter der gentagne gange er i udbrud (fx Braz Afonso,
Raisberg dukker også op). Tallene er solide som "konsistent merværdi udover
placering", men trøje-etiketten er en hypotese. Bekræft med GC-data hvis muligt.

---

## Etape 2+3 (samlet blok — TTT særbehandlet)

Blokken kan **ikke** dekomponeres rent: én Δpris dækker både etape 2 (individuelt
road-resultat) og etape 3 (TTT = holdresultat, alle på et hold får samme tid).
Dertil er PCS-stage-3-filen fejlparset af snippet'en (rank=null, GC-tider lagt i
`status`-feltet) → TTT-placeringer kan ikke joines individuelt. TTT-leder efter
blokken: **Matteo Jorgenson / Visma**. Blokkens største stigninger (Baudin,
Charmig, Braz Afonso, Vauquelin, Jorgenson, Tulett) bruges kun til orientering,
ikke til koefficient-fit. Hvis snippet'en skal fikse TTT-parsing fremover: se
`scripts/snippets/pcs-results.js` (TTT-resultatsiden har afvigende DOM).

---

## Konsekvenser for værktøjet

- **Captain/leverage:** den absolutte Δpris (præmie + baseline + holdbonus) er det
  der bankes. Bjergetaper dominerer → kaptajn på en topplacering dér slår en flad
  sejr markant.
- **Team-stacking:** +60k til hver holdkammerat ved holdsejr er bekræftet og
  stacker med trøje-bonus → 2 ryttere fra et favorithold er reelt korreleret upside.
- **Trade-likviditet:** baseline=0 på flade etaper betyder at man kan holde en
  rytter henover en flad dag uden værditab; på bjergetaper koster det at sidde i
  feltet (−67k median) — endnu en grund til at eje de rigtige klatrere før uge 3.
- Koefficienterne er gemt i `artifacts/value-formula.json` til backtest-/
  leverage-motoren (roadmap #4–5).

## Åbne punkter / forbehold

- Stage 1 = HAR; vinder-rank-1 er entanglet med trøjeerobring (udelad).
- Stage 2+3 udekomponérbar (TTT) — fix snippet-TTT-parsing for fremtidige løb.
- Trøje vs. udbruds-rytter kan ikke skelnes uden klassementsdata.
- Placeringspræmiens *eksakte* funktionsform (lineær/eksponentiel i rank) og dens
  skalering med etapekategori bør re-kalibreres på TdF 2025 (HANDOVER §3) — her
  har vi kun 2 flade + 3 bjerg + 1 hård etape at fitte på.
