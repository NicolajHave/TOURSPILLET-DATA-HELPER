# PCS-backfill — Solution A (browser-snippet)

Din egen browser passerer PCS' bot-detection. Vi læser resultattabellen direkte
fra den renderede side, kopierer ren JSON til udklipsholderen og gemmer den som
en fil i `fixtures/pcs/`. Når filerne ligger der, kører ét script dem ind i
databasen.

To slags data:
1. **Etape-features** (afstand + profiltype) — én side per løb (oversigten).
2. **Resultater** (placering per rytter) — én side per etape.

---

## 0. Engangsopsætning

```bash
git clone https://github.com/NicolajHave/TOURSPILLET-DATA-HELPER.git
cd TOURSPILLET-DATA-HELPER
npm install
cp .env.example .env.local        # udfyld med dine Supabase-værdier
```

I `.env.local` (den er gitignored — commit den aldrig):

```
NEXT_PUBLIC_SUPABASE_URL=https://aypygqcwycpufpwqtxnl.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<din service_role-nøgle fra Supabase > Project Settings > API>
```

Tabellerne ligger allerede i `tourspillet`-schemaet i loge19-projektet.

---

## 1. Sådan kører du en konsol-snippet

1. Åbn siden i Chrome/Edge.
2. Tryk **F12** → fanen **Console**.
3. Første gang skriver du `allow pasting` + Enter (browseren spærrer indsæt i konsollen som beskyttelse).
4. Indsæt hele snippet-filen, tryk Enter.
5. Outputtet er nu i din udklipsholder. Konsollen fortæller hvilket filnavn du skal gemme det som.

Snippet-filerne ligger i `scripts/snippets/`:
- `pcs-stages.js` — kør på løbets etapeoversigt.
- `pcs-results.js` — kør på hver etapes resultatside.

---

## 2. Etape-features (én gang per løb)

Gå til løbets etapeoversigt, fx:
`https://www.procyclingstats.com/race/tour-de-france/2025/stages`

Kør `pcs-stages.js`. Gem outputtet som:
`fixtures/pcs/tour-de-france-2025-stages.json`

> Hvis `parcoursType` kommer ud som `null`, gør det ikke noget — klassifikatoren
> falder tilbage på ProfileScore/højdemeter. Du kan også rette de ~21 felter i
> hånden i filen (fx sætte `"parcoursType": "mountain_summit_finish"` på en
> bjergankomst). Filen er bare JSON.

---

## 3. Resultater (én gang per etape)

For hver etape, gå til resultatsiden:
`https://www.procyclingstats.com/race/tour-de-france/2025/stage-1/result/result`

Kør `pcs-results.js`. Gem som:
`fixtures/pcs/tour-de-france-2025-stage-1.json`

Gentag for stage-2, stage-3 … (prologue gemmes som `stage-0`).

---

## 4. Hvilke løb skal med (prioriteret)

**Til backtesten (skal bruges):**
- Tour de France 2025 — `/race/tour-de-france/2025/stages` + 21 etaper
- Vuelta a España 2025 — `/race/vuelta-a-espana/2025/stages` + etaper

**Til live-modellens form-signal (2026):**
- Critérium du Dauphiné 2026 — `/race/dauphine/2026/stages`
- Tour de Suisse 2026 — `/race/tour-de-suisse/2026/stages`
- Giro d'Italia 2026 — `/race/giro-d-italia/2026/stages`
- Forårsklassikere efter behov (punchy/brosten-signal)

Start med TdF 2025 — det er det eneste, der gater backtesten.

---

## 5. Kør det ind i databasen

```bash
npm run ingest:pcs
```

Scriptet læser alle filer i `fixtures/pcs/`, klassificerer hver etape og
upserter `races` / `race_stages` / `results`. Det er idempotent — kør det igen
når du har tilføjet flere filer.

---

## 6. Fejlsøgning

- **"Ingen resultattabel fundet"** → kopiér konsol-beskeden til Claude, så
  justeres selektoren. (PCS' markup kan have ændret sig.)
- **Forkerte kolonner / navne** → kopiér de første par rækker af outputtet til
  Claude.
- **Rytter-linking** sker separat, når Tour-spillets ryttere er hentet ind via
  holdet-snippet — backfillen gemmer rytteren ved PCS-slug indtil da.

## 7. Vær høflig

Du sidder bag en rigtig browser, så du er ikke en bot — men spam ikke siderne.
Hent én side ad gangen i et normalt tempo. Det er en engangsopgave for 2025.
