-- Run once in the Supabase SQL editor (Project → SQL → New query).
-- Tables are only reached from the server with the service-role key, so RLS is
-- switched on with no policies: the public anon key can read nothing.

create table if not exists intake_sessions (
  id text primary key,
  resume_code text unique not null,
  status text not null check (status in ('intake', 'review', 'paused', 'approved', 'cancelled')),
  paused_from text,
  starting_input text not null,
  source_url text,
  version integer not null default 1,
  approved_version integer,
  created_at text not null,
  updated_at text not null
);

create table if not exists intake_answers (
  session_id text not null references intake_sessions(id) on delete cascade,
  field text not null,
  value text,
  status text not null check (status in ('missing', 'suggested', 'answered', 'unknown')),
  basis text,
  updated_at text not null,
  primary key (session_id, field)
);

create table if not exists intake_statements (
  id bigint generated always as identity primary key,
  session_id text not null references intake_sessions(id) on delete cascade,
  field text not null,
  text text not null,
  kind text not null check (kind in ('observation', 'claim', 'assumption')),
  superseded integer not null default 0
);

create table if not exists intake_events (
  id bigint generated always as identity primary key,
  session_id text not null references intake_sessions(id) on delete cascade,
  type text not null,
  payload text,
  at text not null
);

create index if not exists intake_statements_session on intake_statements (session_id, superseded);
create index if not exists intake_events_session on intake_events (session_id);

alter table intake_sessions enable row level security;
alter table intake_answers enable row level security;
alter table intake_statements enable row level security;
alter table intake_events enable row level security;
