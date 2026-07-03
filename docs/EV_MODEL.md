# EV-model — rankinglag (kalibreret + holdout-valideret)

Roadmap #5's prædiktionskerne. Status: **kalibreret på TdF 2025, valideret på
Vuelta 2025 (holdout) — slår både tilfældig og favorit-proxy.**
Kør: `npm run calibrate:ev`. Kode: `scripts/calibrateEV.ts` (+ `src/lib/forecaster.ts`).

## Model
`strength = form + β·profileFit`, β kalibreret **kun** på TdF 2025 (grid-søgning
der maksimerer recall@15 af faktiske top-10), derefter **låst**. Vuelta = holdout.
Strikt no-lookahead: hver etapes prædiktion bruger kun resultater dateret FØR den
etape. Form-historik er global på tværs af 2025-løb (Vuelta-ryttere bærer deres
TdF-form — TdF er før Vuelta, legitimt).

**Fund:** optimum er **profileFit-domineret** (β≥20, ramte grid-kanten). Dvs.
profil-specifik nylig evne er signalet; generisk `form` bidrager reelt kun som
**fallback** når en rytter ingen profil-historik har (cold-start). Konsistent med
at profileFit korrelerede stærkere (0,51) end form (0,35) i sanity-gaten.

## Resultater (recall@15 af faktiske top-10)

| | model | favorit-proxy | tilfældig |
|---|--:|--:|--:|
| **TdF 2025** (kalibrering) | 0,452 | 0,395 | 0,088 |
| **Vuelta 2025** (HOLDOUT) | **0,378** | 0,233 | 0,091 |

Modellen **generaliserer** (holdout-edge +0,145 > kalibrerings-edge +0,057 →
ikke overfittet). Den slår tilfældig massivt og favorit-proxyen klart.

### Per profil (holdout, Vuelta)
| profil | n | model | favorit | edge |
|---|--:|--:|--:|--:|
| sprint | 1 | 0,300 | 0,000 | +0,300 |
| punch | 2 | 0,400 | 0,050 | +0,350 |
| break | 3 | 0,233 | 0,100 | +0,133 |
| mountain | 11 | 0,427 | 0,318 | +0,109 |
| itt | 1 | 0,300 | 0,300 | +0,000 |

**Ærlige forbehold (skjuler ikke svaghed i et gennemsnit):**
- **break er svag i absolutte tal** (recall ~0,20–0,23) — udbruds-/break-dage er
  notorisk uforudsigelige. Modellen *edger* favoritten, men fanger reelt <¼ af
  top-10. Forvent lav tillid til break-prædiktioner.
- **Lille n på flere Vuelta-profiler** (sprint 1, punch 2, itt 1) → de edges er
  støjende. De robuste tal er **mountain (n=11, +0,109)** og break (n=3).
- På **TdF-bjerg er model == favorit** (0,680) — dér fanger kumulativ form allerede
  klatrerne; modellens *merværdi* over favoritten ligger mest på specialist-etaperne
  (sprint/punch/break), hvor profil-specificitet adskiller.
- **Vuelta-"mountain" (11) blander bjergankomst og break** (klassificeret fra
  profileScore, som uden `profileScoreFinal` ikke kan skelne top fra dal).
- **Favorit-proxy = kumulativ form, ikke ægte markedspris** (ingen holdet-priser
  for TdF/Vuelta). En ægte markedsværdi-baseline kræver PCS' rytter-ranking (anden
  scrape) — så "edge over marked" er edge over *kumulativ form*, ikke over priser.
- **Cold-start:** TdF tidlige etaper har kun within-race form (ingen forår-2025-data).

## Kobling til expectedDelta
`strength` → placeringsfordeling (Plackett-Luce, `forecaster.ts`) → `expectedDelta`
via værdikurven. Rankinglaget her er det kalibrerede/validerede; expectedDelta-
mapningen er mekanisk testet (`npm run prove:forecaster`).

## Ende-til-ende kaptajn-backtest (`npm run backtest:captain`)
Kalibreret EV koblet ind → kaptajn pr. etape (no-lookahead), scoret i realiseret kr:
- **Slår tilfældig massivt** (354k vs 4k kr/etape) og **edger chalk/GC-favorit** (354k vs 322k).
- **Edgen over chalk kommer fra specialist-etaper:** spurt 379k vs GC-fav 33k (vælger
  spurteren, ikke GC-stjernen); på bjerg er de enige (GC-stjernen ER rigtig dér).
- **Stabilitet:** kaptajn == GC-favorit 65–72 % (så ~30 % kontrære, profil-drevne valg);
  uændret stage-til-stage 39 %, resten skifter MED profilen — ønsket, ikke støj.
- **Ærlige svagheder:** break negativ/lav tillid (recall 0,20 — kaptajn dér er nær gæt);
  ITT svag (tynd profileFit-historik, n lille). Kontrærhed vs feltet kan ikke måles
  uden ejerandele → live-fladen (paper-trade fra 4/7).

## Næste
- `profileScoreFinal`-fangst (fix snippet-regex) → ren bjerg-vs-break-klassifikation.
- PCS rytter-ranking → ægte markedsværdi-baseline.
- Før-løb-form (sæson-historik via ryttersider, efter Tour-startliste) → fjerner cold-start.

## Per-profil vindersandsynlighed (γ) — 3/7-2026
`P(i vinder) ∝ strength^γ` MLE-fittet PR. PROFIL på 50 etaper (TdF+Vuelta 2025
fit, Dauphiné/Suisse 2026 holdout), `npm run calibrate:winprob`:

| profil | n | γ* | P(favorit vinder), gns. |
|---|---:|---:|---:|
| break | 7 | **1.0** | 3 % (lotteri — bekræfter lav-tillid) |
| sprint | 8 | 1.5 | 8 % |
| itt | 4 | (tynd → poolet 2) | 17 % |
| mountain | 22 | **2.5** | 18 % |
| punch | 9 | **2.5** | 19 % |

Poolet γ=1.5 udglattede favorit-dominansen væk på bjerg/punch og gav fx Pogačar
P(sejr)=5 % på bjerg. `WIN_PROB_GAMMA_BY_PROFILE` (evModel.ts) bruges nu af både
fladen's Plackett-Luce-MC (kandidat-expΔ/σ/P(sejr)) og holdbonus-kanalen.
Fladen's kandidat-expΔ er MC-forventningen over placeringsfordelingen (konveks
kurve → lavere, ærligere niveauer end deterministisk plads-1-værdi); udsyn +
trin 3/4 beholder den deterministiske kurve (lib-paritet) — samme rangorden.

## GC/trøje-kanal (v1, synlig men ikke i expΔ) — 3/7-2026
Dauphiné-residualerne (fører +140k/dag, høj GC +66-90k/dag) er den største
umodellerede kanal over 21 dage. v1 i fladen: `GC/dag`-kolonne = P(gul)·140k +
(P(top-4)−P(gul))·80k, hvor P'erne kommer fra PL-MC over gcStrength = form +
β·(0,7·fit_mountain + 0,3·fit_itt), γ=2.5. BEVIDST ikke lagt i expΔ/leverage:
koefficienterne er Dauphiné-skala (TdF-hypotese) — brug som tie-breaker + grund
til at HOLDE GC-stjerner over flade dage. Kalibrér på TdF 2026-snapshots når de
første etaper er kørt.
