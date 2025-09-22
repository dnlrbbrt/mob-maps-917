-- Debug script to identify leaderboard issues

-- 1. Check if spots have clips
select 
  s.id as spot_id,
  s.title,
  s.owner_user_id,
  count(c.id) as clip_count,
  max(c.vote_count) as highest_vote_count
from spots s
left join clips c on c.spot_id = s.id
group by s.id, s.title, s.owner_user_id
order by clip_count desc;

-- 2. Check clips and their vote counts
select 
  c.id as clip_id,
  c.spot_id,
  c.user_id,
  c.vote_count,
  c.created_at,
  p.username
from clips c
left join profiles p on p.id = c.user_id
order by c.vote_count desc, c.created_at asc;

-- 3. Check votes table
select 
  v.id as vote_id,
  v.clip_id,
  v.user_id,
  v.created_at,
  c.vote_count,
  p.username as voter_username
from votes v
left join clips c on c.id = v.clip_id
left join profiles p on p.id = v.user_id
order by v.created_at desc;

-- 4. Check profile data
select 
  p.id,
  p.username,
  p.display_name,
  count(s.id) as spots_owned
from profiles p
left join spots s on s.owner_user_id = p.id
group by p.id, p.username, p.display_name
order by spots_owned desc;

-- 5. Check mob membership
select 
  m.id as mob_id,
  m.name as mob_name,
  m.invite_code,
  count(mm.user_id) as member_count
from mobs m
left join mob_members mm on mm.mob_id = m.id
group by m.id, m.name, m.invite_code;

-- 6. Test the leaderboard functions
select 'User Leaderboard:' as debug_info;
select * from get_leaderboard(10);

select 'Mob Leaderboard:' as debug_info;
select * from get_mob_leaderboard(10);

-- 7. Check if vote count trigger is working
-- This will show discrepancies between actual votes and vote_count field
select 
  c.id as clip_id,
  c.vote_count as stored_vote_count,
  count(v.id) as actual_vote_count,
  (c.vote_count = count(v.id)) as counts_match
from clips c
left join votes v on v.clip_id = c.id
group by c.id, c.vote_count
having c.vote_count != count(v.id);
