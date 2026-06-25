# Backfill-checklist — TdF 2025 (hybrid trin 1: per-etape)

> **BRANCH: `main`.** Alt arbejde ligger på `main` (feature-branchen blev merget
> via PR #3 og findes ikke længere på origin). Gem/commit/upload alle datafiler
> til `main` — i GitHub Desktop: Pull `main` → læg filer i `fixtures/pcs/` →
> commit til `main` → push. Eller i browseren: "Add file → Upload files" til `main`.

**Hvorfor manuelt:** PCS er blokeret fra dette miljø (egress-allowlist + PCS'
datacenter-blok). Din egen browser passerer. Dette er en engangsopgave.

**Hvad TdF 2025 bruges til** (vigtigt — rettet antagelse, se `VALUE_FORMULA.md`):
form-signal (`form()`/`profileFit()`), backtest-substrat og strukturel
trøje-verifikation. **Ikke** til at re-fitte prisformlens koefficienter — der
findes ingen holdet-prisdata for 2025; prisformlen fittes kun på Dauphiné.

Fremgangsmåde for hver side: åbn i Chrome → F12 → Console → (første gang:
`allow pasting` + Enter) → indsæt snippet → Enter → gem clipboard som filen.
Snippets ligger i `scripts/snippets/`. Detaljer: `docs/PCS_BACKFILL.md`.

Scope-disciplin (HANDOVER §5): vi bruger HELE etaperesultatet pr. side (snippet'en
tager alle ryttere på én gang), så per-etape = kun 22 sider for hele TdF 2025.

---

## A. Etapeoversigt (1 side — kør `pcs-stages.js`)

- [ ] `https://www.procyclingstats.com/race/tour-de-france/2025/stages`
      → gem som `fixtures/pcs/tour-de-france-2025-stages.json`

> Hvis `parcoursType` bliver `null` for nogle etaper: ok, klassifikatoren falder
> tilbage på højdemeter/ProfileScore. Du kan rette felter i hånden i JSON-filen
> (fx `"parcoursType": "mountain_summit_finish"` på bjergankomster).

## B. Etaperesultater (21 sider — kør `pcs-results.js`)

Mønster: `…/race/tour-de-france/2025/stage-{N}/result/result`
→ gem som `fixtures/pcs/tour-de-france-2025-stage-{N}.json`

- [ ] stage-1   - [ ] stage-2   - [ ] stage-3   - [ ] stage-4   - [ ] stage-5
- [ ] stage-6   - [ ] stage-7   - [ ] stage-8   - [ ] stage-9   - [ ] stage-10
- [ ] stage-11  - [ ] stage-12  - [ ] stage-13  - [ ] stage-14  - [ ] stage-15
- [ ] stage-16  - [ ] stage-17  - [ ] stage-18  - [ ] stage-19  - [ ] stage-20
- [ ] stage-21

(TdF 2025 har ingen prolog; start ved stage-1.)

## C. Kør ind + commit

```bash
npm run ingest:pcs          # idempotent — kan køres igen når du tilføjer filer
git add fixtures/pcs/tour-de-france-2025-*.json
git commit -m "Backfill TdF 2025 PCS results"
```

Commit JSON-filerne til branchen, så kalibrering/backtest kan køre på dem (de
læses direkte fra `fixtures/pcs/`, præcis som Dauphiné-inferensen).

---

## D. VALGFRI — lås trøjebonussen (lille opgave, Dauphiné 2026)

`jerseyBonus` er pt. `verified:false` i artefakten (residual-baseret). For at
**verificere** den skal vi bruge **Dauphiné 2026**-klassementsstandinger (det er
DÉR vi målte bonussen — ikke TdF 2025). PCS-slug for Dauphiné 2026 =
`tour-auvergne-rhone-alpes`. Mest værdi: standingerne efter E4 og E5 (hvor vi så
Baudin +140k, Vauquelin +90k, Onley +80k):

- [ ] `…/race/tour-auvergne-rhone-alpes/2026/stage-5/gc`     (GC/førertrøje)
- [ ] `…/race/tour-auvergne-rhone-alpes/2026/stage-5/youth`  (ungdom/hvid)
- [ ] `…/race/tour-auvergne-rhone-alpes/2026/stage-5/points` + `/kom`

> Den nuværende `pcs-results.js` tager "første tabel med ryttere" = GC-tabellen på
> en GC-side, men filnavn/shape bliver tvetydigt. Sig til når du vil hente dem, så
> leverer jeg en lille `pcs-standings.js`-variant + parser, der mærker classification.
> Indtil da: hold `jerseyBonus` ude af låste koefficienter.

---

## Næste skridt på MIN side (parallelt, ublokeret)
- TRIN 4: seed-skabelon for TdF 2026-ruten (`fixtures/route/…seed.json`) + guardrail.
- TRIN 5: design + interfaces + syntetiske unit-tests for forecaster + transfer-
  evaluator (bygges fuldt FØRST når kalibrering + backtest-sanity er bestået).
