-- Tourspillet Data Helper — core ingest schema
-- Source of truth: holdet.dk "Cycling Trading 8 Riders" ruleset,
-- extracted from GET /api/games/{gameId}/players and
-- GET /api/cartridges/{slug} -> _embedded.rulesets.
--
-- Design notes:
--   * riders + teams are GLOBAL (a rider keeps the same personId across games,
--     so Dauphiné data and Tour data share rows).
--   * game_players is the per-game roster (price/popularity live on snapshots).
--   * snapshots is the daily time series — one batch per ingest.
--   * For a single-user personal tool, write server-side with the service_role
--     key. Either keep RLS off (private project, no anon access) or enable RLS
--     and add per-user policies later. Supabase will warn if RLS is off.

create table if not exists teams (
  id            integer primary key,                 -- holdet teamId
  name          text not null,
  abbreviation  text,
  slug          text,
  updated_at    timestamptz not null default now()
);

create table if not exists riders (
  id          integer primary key,                   -- holdet personId (global)
  first_name  text,
  last_name   text,
  full_name   text generated always as (
                trim(coalesce(first_name,'') || ' ' || coalesce(last_name,''))
              ) stored,
  updated_at  timestamptz not null default now()
);

create table if not exists games (
  id                   integer primary key,          -- holdet gameId
  edition_id           integer,
  stream_id            integer,
  slug                 text,                          -- e.g. tour-de-france-2026
  name                 text,
  salary_cap           bigint  not null default 50000000,
  transfer_fee         numeric not null default 0.01, -- 1% on a bought rider
  interest_rate        numeric not null default 0.005,-- 0.5% per round on bank
  captain_bonus_assets integer not null default 1,
  created_at           timestamptz not null default now()
);

create table if not exists game_players (
  id          integer primary key,                   -- holdet player id (per game)
  game_id     integer not null references games(id) on delete cascade,
  rider_id    integer not null references riders(id),
  team_id     integer references teams(id),
  position_id integer,
  start_price bigint,
  updated_at  timestamptz not null default now()
);
create index if not exists idx_game_players_game on game_players(game_id);

create table if not exists rounds (
  id           bigint generated always as identity primary key,
  game_id      integer not null references games(id) on delete cascade,
  round_index  integer not null,                     -- 0,1,2... in schedule order
  name         text,                                  -- stage / venue
  close_at     timestamptz,                           -- TRANSFER DEADLINE
  end_at       timestamptz,
  unique (game_id, round_index)
);

create table if not exists snapshots (
  id           bigint generated always as identity primary key,
  game_id      integer not null references games(id) on delete cascade,
  player_id    integer not null references game_players(id) on delete cascade,
  captured_at  timestamptz not null default now(),
  round_index  integer,                               -- round this snapshot precedes
  price        bigint  not null,
  points       integer not null default 0,
  popularity   numeric not null default 0,            -- ownership fraction 0..1
  is_out       boolean not null default false,
  unique (player_id, captured_at)
);
create index if not exists idx_snapshots_game_round on snapshots(game_id, round_index);
create index if not exists idx_snapshots_player     on snapshots(player_id);

create table if not exists my_squad (
  id          bigint generated always as identity primary key,
  game_id     integer not null references games(id) on delete cascade,
  player_id   integer not null references game_players(id),
  round_index integer not null,
  is_captain  boolean not null default false,
  unique (game_id, player_id, round_index)
);
