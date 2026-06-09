# CLAUDE.md

Læs **docs/HANDOVER.md** først — den er den autoritative brief (mål, datakilder,
endpoints, skema, revideret roadmap, gotchas).

Hurtig kontekst:
- Beslutningsværktøj til holdet.dk Tourspillet (TdF 2026). Mål: absolut #1 blandt
  ~30.000+ → leverage/variance-optimering, ikke ren EV.
- Alt i TypeScript. Supabase-projekt "loge19" (aypygqcwycpufpwqtxnl), schema
  `tourspillet`. Hemmeligheder i .env.local — commit aldrig nøgler.
- AKUT til 14/6-2026: daglige holdet-snapshots af Dauphiné (game 622) — bruges
  til empirisk værdiformel-inferens. Se HANDOVER §0 og §8.
- PCS blokerer datacenter-kald → kun browser-snippets (scripts/snippets/).
- No-lookahead i alt historik-baseret arbejde.
- Validering: npm run prove / npm run prove:slice1. Ingest: npm run ingest:pcs.
- Svar på dansk. Vær sparringspartner: udfordr antagelser, ret fejl tydeligt.
