# Forecaster + transfer-evaluator (TRIN 5)

Beslutningsmotorens **design + interfaces + syntetiske unit-tests**. Status:
skelet er bygget og mekanik-testet (`npm run prove:forecaster`, 26/26). Den
**fulde** kobling til rigtige squads/form-data aktiveres FØRST når forecasterens
parametre er kalibreret på TdF 2025 **og** har bestået en backtest-sanity-check
(HANDOVER §3). Byg ikke beslutninger på de ukalibrerede defaults.

Filer: `src/lib/forecaster.ts`, `src/lib/transferEvaluator.ts`,
tests `scripts/proveForecaster.ts`.

## Hvad er KALIBRERET vs IKKE

| Lag | Kilde | Status |
|---|---|---|
| **Værdikurve** (placering→kr, baseline, +60k, −100k, exp-form) | Dauphiné 2026 (`artifacts/value-formula.json`) | inferred, medium-high konfidens |
| **Forecaster-model** (vægte wForm/wFit/wArch, temperature, dnf-rate) | `DEFAULT_PARAMS` | **UKALIBRERET** — fit på TdF 2025 (TRIN 2) |

Adskillelsen er bevidst: værdiformlen er empirisk, men *sandsynligheden* for en
placering er endnu en hypotese. `coeffsFromArtifact()` læser den kalibrerede
værdikurve ind; modellens parametre er eksponeret og flaggede.

## 5a — placerings-forecaster (`forecaster.ts`)

```
strength = exp((wForm·form + wFit·profileFit + wArch·archMatch) / temperature)
finishing order ~ Plackett-Luce(strength)   (seeded Monte-Carlo, deterministisk)
expectedDelta = (1−pDnf)·Σ P(bucket)·value(bucket)  +  pDnf·(−dnfPenalty)
```

- `archMatch` = `dot(rytterens archetype, archetypeWeights(profil))` — kobler
  `stageProfile.ts` til rytter-typen.
- Outcome-buckets: win / podium / top10 / top20 / field, betinget af at gennemføre.
- `value(bucket)` via `valueOfRank()` på den **eksponentielle** værdikurve (NB:
  ikke `placingScore`/1-√rank — værdikurven er stejlere i toppen, se VALUE_FORMULA.md).
- Vinder får `value(1) + teamBonus`; holdkammerat-sejr (stacking) lægger `teamBonus`
  oven i via `teammateWinProb`.
- Bjerg vs flad skala vælges af `scaleOf(profile)`.

## 5b — transfer-evaluator (`transferEvaluator.ts`)

```
NetGain(H) = Σ_{i=1..H} decay^(i-1)·(E[Δ_Y(i)] − E[Δ_X(i)])
             − buyFee(Y) − forventet unwind-gebyr + rente på frigjort kontant
```

- **Diskontering** `decay^(i-1)` for stigende forudsigelses-usikkerhed; `confidence`
  rapporteres pr. horisont og `flagged=true` under tærskel ⇒ H=3-anbefalinger på
  støj markeres. `best` vælges blandt ikke-flaggede horisonter.
- **Leverage-overlay** (turneringsmål): `leverageAdjusted` vægter hver side med
  under-ejerandel `(1−ownership)` — en stiger få ejer rykker dig op; en stiger
  alle ejer giver nul relativ gevinst.
- **Rente** på frigjort kontant (`priceX − priceY`) ved `interestRate` 0,5 %/runde.

## 5c — output = BREAK-EVEN-PLACERING (primær beslutning)

I stedet for kun et tal: `breakEven.requiredRank` = den placering Y i snit skal
levere pr. etape for at skiftet er positivt, via `rankForValue()` (invers værdikurve).
Eksempel-formulering genereres: *"Køb Y er positivt over H etaper hvis Y i snit
leverer top-10 (≈ plads 7) pr. etape."* Plus `netGain` og `confidence`.

## 5d — constraints (`checkConstraints`)

8 ryttere, max 2 pr. rigtigt hold, salary cap 50M. v1 = grådig per-slot:
`applySwap()` + `checkConstraints()` efter hver kandidat. Fuld
squad-trajektorie-optimering er senere.

## Næste (gated)
1. Kalibrér `DEFAULT_PARAMS` på TdF 2025 (kræver PCS-backfill — se checklist).
2. Backtest-sanity: slå baselines (chalk-hold / random kaptajn / GC-favorit).
3. Først DEREFTER: kobl til live holdet-squad + paper-trade (roadmap #3).
