// src/lib/parseSnapshot.ts
// Turns the RAW response of GET /api/games/{gameId}/players (the object with
// `items` + `_embedded`) into normalized rows ready to upsert into Supabase.
//
// The browser snippet copies the raw response to the clipboard; paste it into
// the tool's import field and run parsePlayersResponse() on the parsed JSON.

export interface RawPlayersResponse {
  items: Array<{
    id: number;          // game-specific player id
    personId: number;    // global rider id
    teamId: number;
    positionId: number;
    startPrice: number;
    price: number;
    points: number;
    popularity: number;  // fraction 0..1
    isOut: boolean;
  }>;
  _embedded: {
    persons?: Record<string, { id: number; firstName?: string; lastName?: string }>;
    teams?: Record<string, { id: number; name: string; abbreviation?: string; slug?: string }>;
    positions?: Record<string, { id: number; title?: string }>;
  };
}

export interface RiderRow { id: number; first_name: string | null; last_name: string | null; }
export interface TeamRow { id: number; name: string; abbreviation: string | null; slug: string | null; }
export interface GamePlayerRow {
  id: number; rider_id: number; team_id: number | null;
  position_id: number; start_price: number;
}
export interface SnapshotRow {
  player_id: number; price: number; points: number;
  popularity: number; is_out: boolean;
}

export interface ParsedSnapshot {
  riders: RiderRow[];
  teams: TeamRow[];
  gamePlayers: GamePlayerRow[];
  snapshots: SnapshotRow[];
  capturedAt: string;
}

export function parsePlayersResponse(
  raw: RawPlayersResponse,
  capturedAt: string = new Date().toISOString(),
): ParsedSnapshot {
  const persons = raw._embedded?.persons ?? {};
  const teams = raw._embedded?.teams ?? {};

  const riders: RiderRow[] = Object.values(persons).map((p) => ({
    id: p.id,
    first_name: p.firstName ?? null,
    last_name: p.lastName ?? null,
  }));

  const teamRows: TeamRow[] = Object.values(teams).map((t) => ({
    id: t.id,
    name: t.name,
    abbreviation: t.abbreviation ?? null,
    slug: t.slug ?? null,
  }));

  const gamePlayers: GamePlayerRow[] = raw.items.map((i) => ({
    id: i.id,
    rider_id: i.personId,
    team_id: i.teamId ?? null,
    position_id: i.positionId,
    start_price: i.startPrice,
  }));

  const snapshots: SnapshotRow[] = raw.items.map((i) => ({
    player_id: i.id,
    price: i.price,
    points: i.points,
    popularity: i.popularity,
    is_out: i.isOut,
  }));

  return { riders, teams: teamRows, gamePlayers, snapshots, capturedAt };
}

/** Convenience: a flat, human-readable view for quick inspection / CSV export. */
export function toFlatRows(raw: RawPlayersResponse) {
  const persons = raw._embedded?.persons ?? {};
  const teams = raw._embedded?.teams ?? {};
  return raw.items.map((i) => {
    const p = persons[String(i.personId)];
    const t = teams[String(i.teamId)];
    return {
      personId: i.personId,
      name: `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.trim(),
      team: t?.name ?? '',
      teamCode: t?.abbreviation ?? '',
      price: i.price,
      startPrice: i.startPrice,
      delta: i.price - i.startPrice,
      points: i.points,
      ownershipPct: +(i.popularity * 100).toFixed(2),
      isOut: i.isOut,
    };
  });
}
