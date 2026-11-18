-- Technically Social: database update for profile details + photos
-- Written by Himal Shrestha
--
-- Adds first/last name, 18+, sex, location and photo to each person's profile,
-- creates the cloud folder for profile photos, and adds the sign-up function.
--
-- This runs AFTER the first migration (the file names start with dates, so
-- Supabase runs them in order). It doesn't throw away anything that's already
-- there, it just adds new stuff on top.

-- ==================================================================
-- NEW PROFILE COLUMNS
-- Extra details stored for each person.
-- ==================================================================
-- New columns on the users table.
-- Everything here is optional (allowed to be empty) except first/last name,
-- which the form makes required.
-- over_18 is a yes/no: true = 18 or older, false = under 18,
-- empty (null) = they'd rather not say. I'm keeping the old "name" column too,
-- filled in as "First Last", so older code that reads "name" still works.
alter table public.users
  add column first_name text,
  add column last_name  text,
  add column over_18    boolean,
  add column sex        text    check (sex in ('Female', 'Male', 'Non-binary', 'Other')),
  add column location   text,
  add column photo_url  text;

-- ==================================================================
-- PHOTO STORAGE
-- Where profile pictures are kept.
-- ==================================================================
-- A storage "bucket" is basically a folder in the cloud for files.
-- This one holds profile photos. public = true means anyone with the photo's
-- link can view it, which is what we want so it shows on the attendee list.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- ==================================================================
-- SIGN-UP FUNCTION
-- Called by the server when someone new fills in the form.
-- ==================================================================
-- Saves a brand new attendee AND checks them in for today, in one go.
-- Doing both together means we never end up with a person saved but not
-- checked in (or the other way around) if something breaks halfway.
create or replace function public.register_attendee(
  attendee_first_name text,
  attendee_last_name  text,
  attendee_email      text,
  attendee_linkedin   text,
  attendee_website    text,
  attendee_profession text,
  attendee_over_18    boolean,
  attendee_sex        text,
  attendee_location   text,
  attendance_date     date
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  new_user_id uuid;
begin
  insert into public.users (
    name, first_name, last_name, email, linkedin, website, profession, over_18, sex, location
  )
  values (
    trim(attendee_first_name) || ' ' || trim(attendee_last_name),
    trim(attendee_first_name),
    trim(attendee_last_name),
    lower(trim(attendee_email)),
    trim(attendee_linkedin),
    nullif(trim(attendee_website), ''),      -- nullif turns "" into empty (null)
    nullif(trim(attendee_profession), ''),
    attendee_over_18,
    nullif(trim(attendee_sex), ''),
    nullif(trim(attendee_location), '')
  )
  returning id into new_user_id;

  insert into public.attendance (user_id, date)
  values (new_user_id, attendance_date);

  return new_user_id;
end;
$$;

-- ==================================================================
-- PERMISSIONS
-- Lock the sign-up function down so only our server can use it.
-- ==================================================================
-- Only our own server (which uses the secret "service_role" key) is allowed
-- to call this. Random visitors can't call it directly.
revoke all on function public.register_attendee(text, text, text, text, text, text, boolean, text, text, date)
  from public, anon, authenticated;
grant execute on function public.register_attendee(text, text, text, text, text, text, boolean, text, text, date)
  to service_role;
