# Tourspillet Data Helper

Beslutningsværktøj til holdet.dk Tourspillet — bygget til **absolut topplacering**,
dvs. leverage/variance-optimering frem for ren forventet-værdi. Alt i TypeScript.

## Datakilder
- **Holdet** (pris, point, ejerandel, navne, regler) — ét request:
  `GET https://nexus-app-fantasy.holdet.dk/api/games/{gameId}/players`
  Regler i `GET /api/cartridges/{slug}` → `_embedded.rulesets`
  (transferFee 0.01, interestRate 0.005, salaryCap 50M, captainBonusAssets 1).
- **PCS** (resultater + etapeprofiler) — browser-snippet (solution A), da PCS
  blokerer datacenter-kald. Se `docs/PCS_BACKFILL.md`.

## Struktur
- `supabase/migrations/` — skema (holdet-ingest + PCS-resultater), schema `tourspillet`
- `src/lib/ruleset.ts` — regelmotor (gebyr, rente, kaptajnsbonus, leverage-score)
- `src/lib/parseSnapshot.ts` — holdet /players-svar → normaliserede rækker
- `src/lib/stageProfile.ts` — etapeklassifikator + arketype-vægte
- `src/lib/form.ts` — recency-vægtet form + profil-fit (no-lookahead)
- `src/lib/parsePcsExport.ts` — PCS-snippet-output → DB-rækker + klassifikation
- `scripts/snippets/` — browser-snippets (holdet + PCS)
- `scripts/prove*.ts` — valideringsscripts (`npm run prove`, `npm run prove:slice1`)
- `scripts/ingestPcs.ts` — lokal ingest af PCS-filer (`npm run ingest:pcs`)

## Kom i gang
```bash
npm install
cp .env.example .env.local   # udfyld Supabase-værdier
npm run prove                # holdet-pipeline på Dauphiné-fixture
npm run prove:slice1         # etapeklassifikator + form
```

## Database
Schema `tourspillet` i Supabase-projektet loge19 (`aypygqcwycpufpwqtxnl`).
11 tabeller: teams, riders, games, game_players, rounds, snapshots, my_squad,
races, race_stages, results, rider_links.

## Status
- [x] Holdet-ingest: skema + regelmotor + parser (bevist på rigtige data)
- [x] Slice 1: etapeklassifikator + form (7/7 + valideret) + PCS-skema
- [x] PCS-transport: solution A (browser-snippet) + ingest
- [ ] Backfill TdF 2025 (manuel, se docs/PCS_BACKFILL.md)
- [ ] Slice 4: backtest-motor TdF 2025
- [ ] Slice 2+3: schedule/deadlines + daglig import-side
- [ ] Tour-gameId korrektion ved spilåbning
