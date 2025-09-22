-- Missing tables for mobs functionality
-- mobs table
create table if not exists mobs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text unique not null,
  owner_user_id uuid references profiles(id),
  created_at timestamptz default now()
);

-- mob_members table  
create table if not exists mob_members (
  id uuid primary key default gen_random_uuid(),
  mob_id uuid references mobs(id) on delete cascade,
  user_id uuid references profiles(id),
  joined_at timestamptz default now(),
  unique(mob_id, user_id) -- User can only be in one mob at a time
);

-- Indexes for better performance
create index if not exists idx_mobs_invite_code on mobs(invite_code);
create index if not exists idx_mob_members_mob_id on mob_members(mob_id);
create index if not exists idx_mob_members_user_id on mob_members(user_id);

-- Enable RLS
alter table mobs enable row level security;
alter table mob_members enable row level security;

-- Policies for mobs
create policy "Anyone can view mobs" on mobs for select using (true);
create policy "Authenticated users can create mobs" on mobs for insert with check (auth.uid() = owner_user_id);
create policy "Mob owners can update their mobs" on mobs for update using (auth.uid() = owner_user_id);

-- Policies for mob_members
create policy "Anyone can view mob members" on mob_members for select using (true);
create policy "Authenticated users can join mobs" on mob_members for insert with check (auth.uid() = user_id);
create policy "Users can leave mobs" on mob_members for delete using (auth.uid() = user_id);

-- Function to generate invite codes
create or replace function generate_invite_code()
returns text as $$
declare
  code text;
  exists_check int;
begin
  loop
    -- Generate 6 character alphanumeric code
    code := upper(substr(md5(random()::text), 1, 6));
    
    -- Check if it already exists
    select count(*) into exists_check from mobs where invite_code = code;
    
    -- If unique, return it
    if exists_check = 0 then
      return code;
    end if;
  end loop;
end;
$$ language plpgsql;

-- Function to get user leaderboard
create or replace function get_leaderboard(limit_count int default 20)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  spots_owned bigint
) as $$
begin
  return query
  select 
    p.id,
    p.username,
    p.display_name,
    p.avatar_url,
    count(s.id) as spots_owned
  from profiles p
  left join spots s on s.owner_user_id = p.id
  group by p.id, p.username, p.display_name, p.avatar_url
  having count(s.id) > 0
  order by spots_owned desc, p.username asc
  limit limit_count;
end;
$$ language plpgsql;

-- Function to get mob leaderboard
create or replace function get_mob_leaderboard(limit_count int default 20)
returns table (
  mob_id uuid,
  mob_name text,
  total_spots_owned bigint,
  member_count bigint
) as $$
begin
  return query
  select 
    m.id as mob_id,
    m.name as mob_name,
    count(distinct s.id) as total_spots_owned,
    count(distinct mm.user_id) as member_count
  from mobs m
  left join mob_members mm on mm.mob_id = m.id
  left join spots s on s.owner_user_id = mm.user_id
  group by m.id, m.name
  having count(distinct s.id) > 0
  order by total_spots_owned desc, m.name asc
  limit limit_count;
end;
$$ language plpgsql;

-- Ensure the spot owner recalculation trigger exists and works
-- This trigger should fire when a clip's vote_count changes
create or replace function _recalc_spot_owner() returns trigger as $$
begin
  -- Update the spot's owner to be the user with the highest-voted clip
  update spots set owner_user_id = (
    select c.user_id
    from clips c
    where c.spot_id = new.spot_id
    order by c.vote_count desc, c.created_at asc
    limit 1
  )
  where id = new.spot_id;
  return new;
end;
$$ language plpgsql;

-- Make sure the trigger exists
drop trigger if exists trg_clips_vote_update on clips;
create trigger trg_clips_vote_update 
  after update of vote_count on clips 
  for each row 
  execute function _recalc_spot_owner();

-- Also trigger when a new clip is added (in case it's the first clip for a spot)
drop trigger if exists trg_clips_insert_update_owner on clips;
create trigger trg_clips_insert_update_owner
  after insert on clips
  for each row
  execute function _recalc_spot_owner();

-- Function to manually recalculate all spot owners (useful for fixing existing data)
create or replace function recalculate_all_spot_owners()
returns void as $$
begin
  update spots set owner_user_id = (
    select c.user_id
    from clips c
    where c.spot_id = spots.id
    order by c.vote_count desc, c.created_at asc
    limit 1
  )
  where exists (
    select 1 from clips where spot_id = spots.id
  );
end;
$$ language plpgsql;

-- Call the function to fix existing data
select recalculate_all_spot_owners();
