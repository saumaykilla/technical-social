-- Tech Social: database update for per-event themes
-- Written by Himal Shrestha
--
-- Remembers which look (theme) each event date uses. Organizers pick it on
-- the /admin page, and everyone who checks in that day sees it.
-- Run this AFTER the 1114 and 1116 files.

-- ==================================================================
-- EVENT THEMES TABLE
-- One row per event date. No row = the default theme (After hours).
-- ==================================================================
create table public.event_themes (
  date       date primary key,
  theme      text not null check (theme in ('after-hours', 'ticker', 'secure', 'blueprint')),
  updated_at timestamptz not null default now()
);

-- ==================================================================
-- PERMISSIONS
-- Lock it down: only our own server (secret key) can read or change it.
-- The pages always go through the server, never straight to the database.
-- ==================================================================
alter table public.event_themes enable row level security;
revoke all on public.event_themes from anon, authenticated;
