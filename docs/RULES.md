# Tourspillet 2026 — officielt pointsystem (ruleset 117)

> Kilde: bruger-indsendt 3/7-2026 (dagen før E1). Autoritativ for TdF-spillet
> (game 618). Bemærk: Dauphiné-spillet (622) kørte SAMME ruleset (117) — så den
> empirisk inferredé værdiformel (VALUE_FORMULA.md) er målt under disse regler.
> Beløbene herunder er "vækst" (rytterens værdistigning) hhv. bank-indskud.

## Etapeplacering (individuel vækst)
| Plads | Kr. | | Plads | Kr. |
|---|---|---|---|---|
| 1 | 200.000 | | 9 | 85.000 |
| 2 | 150.000 | | 10 | 80.000 |
| 3 | 130.000 | | 11 | 70.000 |
| 4 | 120.000 | | 12 | 55.000 |
| 5 | 110.000 | | 13 | 40.000 |
| 6 | 100.000 | | 14 | 30.000 |
| 7 | 95.000 | | 15 | 15.000 |
| 8 | 90.000 | | 16+ | 0 |

## Etapebonus (BANK-indskud, pr. etape — antal af DINE 8 i etapens top-15)
| Antal | Kr. | | Antal | Kr. |
|---|---|---|---|---|
| 8 | 400.000 | | 4 | 35.000 |
| 7 | 220.000 | | 3 | 15.000 |
| 6 | 120.000 | | 2 | 8.000 |
| 5 | 65.000 | | 1 | 4.000 |

**Stærkt superlineær** (8 ryttere = 400k vs 2×4 = 70k) → belønner
KONCENTRATION på etapetypen. Strategisk hovedargument for stacking.

## Sammenlagt placering efter etapen (individuel vækst, HVER etape)
GC 1: 100.000 · 2: 90.000 · 3: 80.000 · 4: 70.000 · 5: 60.000 ·
6: 50.000 · 7: 40.000 · 8: 30.000 · 9: 20.000 · 10: 10.000

## Trøjer (pr. dag i trøjen)
Fører 25.000 · Point 25.000 · Bjerg 25.000 · Ungdom 15.000 ·
Mest angrebsivrige 50.000
→ Gul fører = 100.000 (GC1) + 25.000 (trøje) = **125.000/dag**.
(Dauphiné-residualet ~140k/dag var altså tæt på — nu har vi de eksakte tal.)

## Spurt-/bjergpoint
3.000 kr pr. point. NYT 2026: helt flade etaper giver 70 point ved målstregen.

## Holdtidskørsel (TTT) — gives til SAMTLIGE aktive ryttere på holdet
| Holdplacering | Kr. |
|---|---|
| 1 | 200.000 |
| 2 | 150.000 |
| 3 | 100.000 |
| 4 | 50.000 |
| 5 | 25.000 |

Ingen individuel etapeplacerings-tabel på TTT. MEN: holdet-tiden registreres på
FØRSTE rytter fra hvert hold → GC efter TTT ordnes efter kryds-rækkefølge →
vinderholdets første rytter tager gul (og hele vinderholdet besætter GC top-8 →
sammenlagt-vækst 100k..30k efter kryds-rækkefølge!).
TdF-2026-quirk på E1 (TTT): pointtrøjen til hurtigste rytter ved mellemtiden,
bjergtrøjen til hurtigste op ad sidste stigning (25k hver) — kan ikke
forudsiges af modellen, manuel vurdering.

## Holdbonus (normale etaper)
Hold 1/2/3 på etapen → 60.000/30.000/20.000 til samtlige ryttere på holdet.
(Værdiformlen har kun 1.-pladsens 60k bekræftet empirisk; 2./3. er nye tal.)

## Kaptajnbonus
Bonus = rytterens vækst × 1 (dvs. kaptajnen tæller dobbelt vækst)
→ kaptajn = max forventet vækst. (captainBonusAssets=1 i ruleset.)

## Sen ankomst / udgået (individuel vækst, negativ)
- −3.000 pr. helt minut efter etapevinderen, maks −90.000
  (⇒ autobussen på bjergetaper taber 60-90k — det ER den empiriske
  mountain-baseline på −67,5k!)
- DNF (udgår undervejs): **−50.000**
- DNS (stiller ikke til start): **−100.000**
  (⇒ værdiformlens −100k-spikes var DNS-events; blended hazard-straf ~−75k)

## Finans
Bankrente 0,5 % pr. runde · Transfergebyr −1 %

## Afstemning mod den empiriske værdiformel (Dauphiné-inferred)
- Placeringspræmien (exp-decay, rank1: flat 281k / mountain 466k) er BUNDTET:
  etapeplacering + samme-dags GC-vækst + trøjer + point. Den officielle
  etapetabel alene (200k) + GC (100k) + trøje (25k) + bjergpoint ≈ 400k+ på
  en bjergsejr — konsistent med de 466k. Formlen er fortsat den rigtige
  PRIS-model; tabellerne her er MEKANISMEN bag.
- mountain-baseline −67,5k ≈ sen-ankomst-straffen for feltet. Bekræftet.
- teamBonus 60k = holdbonus 1. plads. Bekræftet. (2./3. plads = 30k/20k nyt.)
