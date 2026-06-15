// src/lib/valueFormula.ts
// Empirical inference of holdet's hidden VALUE FORMULA (placering -> Δpris) from
// the Dauphiné 2026 snapshot series (HANDOVER §0, §8, roadmap #2).
//
// Holdet does NOT publish how a stage result turns into a price change. We have
// a daily price time-series (snapshots) and the PCS stage results, so we can
// regress one onto the other. The `points` field is 0 for this game variant, so
// PRICE delta is the only observable signal — this module joins price deltas to
// finishing positions and exposes the building blocks for decomposition.
//
// Transport-agnostic: it reads already-saved JSON fixtures, it does not fetch.

import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Name matching (holdet personId/firstName/lastName  <->  PCS slug/name)
// ---------------------------------------------------------------------------

/** Accent-stripped, lower-cased, sorted token key. Order-independent so
 *  "Michael Matthews" and PCS "MATTHEWS Michael" collapse to one key. */
export function nameKey(s: string): string {
  return tokens(s).join(' ');
}

function tokens(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean)
    .sort();
}

export interface RiderRef {
  playerId: number;
  name: string;
  teamId: number;
  teamName: string;
}

/** Index holdet riders for matching: exact token key + token sets for subset
 *  fallback (PCS often carries fewer name tokens than holdet, e.g. PCS
 *  "Cristián Rodríguez" vs holdet "Cristian Rodriguez Martin"). */
export interface RiderIndex {
  byKey: Map<string, RiderRef>;
  list: Array<RiderRef & { tokens: Set<string> }>;
}

export function buildRiderIndex(riders: RiderRef[]): RiderIndex {
  const byKey = new Map<string, RiderRef>();
  const list: Array<RiderRef & { tokens: Set<string> }> = [];
  for (const r of riders) {
    byKey.set(nameKey(r.name), r);
    list.push({ ...r, tokens: new Set(tokens(r.name)) });
  }
  return { byKey, list };
}

/** Resolve a PCS rider name/slug to a holdet rider. Exact key first, then a
 *  unique-superset fallback. Returns null if no unambiguous match. */
export function matchRider(idx: RiderIndex, pcsName: string, pcsSlug?: string): RiderRef | null {
  const exact = idx.byKey.get(nameKey(pcsName));
  if (exact) return exact;
  if (pcsSlug) {
    const bySlug = idx.byKey.get(nameKey(pcsSlug.replace(/-/g, ' ')));
    if (bySlug) return bySlug;
  }
  // unique-superset: every PCS token is present in exactly one holdet rider
  const pcsTok = new Set(tokens(pcsName));
  const supersets = idx.list.filter((r) => [...pcsTok].every((t) => r.tokens.has(t)));
  if (supersets.length === 1) return supersets[0];
  return null;
}

// ---------------------------------------------------------------------------
// Snapshot + PCS loading
// ---------------------------------------------------------------------------

export interface HoldetRider extends RiderRef {
  price: number;
  startPrice: number;
  popularity: number;
  isOut: boolean;
}

export interface HoldetSnapshot {
  byId: Map<number, HoldetRider>;
  riders: HoldetRider[];
}

export function loadHoldetSnapshot(path: string): HoldetSnapshot {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const persons: Record<string, { firstName?: string; lastName?: string }> =
    raw._embedded?.persons ?? {};
  const teams: Record<string, { name?: string }> = raw._embedded?.teams ?? {};
  const riders: HoldetRider[] = raw.items.map((i: any) => {
    const p = persons[String(i.personId)];
    return {
      playerId: i.id,
      name: `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.trim(),
      teamId: i.teamId,
      teamName: teams[String(i.teamId)]?.name ?? `team-${i.teamId}`,
      price: i.price,
      startPrice: i.startPrice,
      popularity: i.popularity,
      isOut: i.isOut,
    };
  });
  return { byId: new Map(riders.map((r) => [r.playerId, r])), riders };
}

export interface PcsResult {
  rank: number | null;
  status: string;
  riderSlug: string;
  riderName: string;
  team: string | null;
}

export interface PcsStage {
  stageNo: number | null;
  results: PcsResult[];
  capturedAt?: string;
}

export function loadPcs(path: string): PcsStage {
  const j = JSON.parse(readFileSync(path, 'utf8'));
  return { stageNo: j.stage?.stageNo ?? null, results: j.results ?? [], capturedAt: j.capturedAt };
}

// ---------------------------------------------------------------------------
// Joining price deltas to results
// ---------------------------------------------------------------------------

export interface StageRow {
  playerId: number;
  name: string;
  team: string;
  priceBefore: number;
  delta: number;          // price_after - price_before (the value the formula sets)
  rank: number | null;    // PCS finishing position (null = DNF / not classified / unmatched)
  status: string;
  isOut: boolean;         // holdet flag in the AFTER snapshot (abandoned)
  matched: boolean;       // did we find a PCS result for this rider?
  onWinningTeam: boolean; // same holdet team as the stage winner
}

export interface JoinedStage {
  rows: StageRow[];
  winnerName: string | null;
  winnerTeam: string | null;
}

/**
 * Join a price delta (before -> after) with a stage's PCS result.
 * `priceBefore` is read per rider from a map so the caller controls the
 * baseline (startPrice for stage 1, previous snapshot otherwise).
 */
export function joinStage(
  priceBefore: Map<number, number>,
  after: HoldetSnapshot,
  pcs: PcsStage,
): JoinedStage {
  const idx = buildRiderIndex(after.riders);
  // map each holdet rider -> their PCS result for this stage
  const resultByPlayer = new Map<number, PcsResult>();
  for (const r of pcs.results) {
    const m = matchRider(idx, r.riderName, r.riderSlug);
    if (m) resultByPlayer.set(m.playerId, r);
  }
  const winner = pcs.results.find((r) => r.rank === 1) ?? null;
  const winnerRef = winner ? matchRider(idx, winner.riderName, winner.riderSlug) : null;
  const winnerTeam = winnerRef?.teamName ?? null;

  const rows: StageRow[] = [];
  for (const rider of after.riders) {
    const before = priceBefore.get(rider.playerId);
    if (before === undefined) continue;
    const res = resultByPlayer.get(rider.playerId);
    rows.push({
      playerId: rider.playerId,
      name: rider.name,
      team: rider.teamName,
      priceBefore: before,
      delta: rider.price - before,
      rank: res?.rank ?? null,
      status: res?.status ?? 'NR',
      isOut: rider.isOut,
      matched: !!res,
      onWinningTeam: winnerTeam != null && rider.teamName === winnerTeam,
    });
  }
  return { rows, winnerName: winner?.riderName ?? null, winnerTeam };
}

// ---------------------------------------------------------------------------
// Small stats helpers (no deps — keep the tool installable on the locked box)
// ---------------------------------------------------------------------------

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

export function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  const d = Math.sqrt(sxx * syy);
  return d === 0 ? NaN : sxy / d;
}

export interface Ols { slope: number; intercept: number; r2: number; n: number }

/** Ordinary least squares y = slope*x + intercept, with R². */
export function ols(xs: number[], ys: number[]): Ols {
  const n = xs.length;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2, n };
}
