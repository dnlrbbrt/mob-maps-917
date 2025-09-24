-- Debug script to identify spot ownership and leaderboard issues

-- 1. Check current spot ownership vs highest voted clips
SELECT 
  s.id as spot_id,
  s.title,
  s.owner_user_id,
  current_owner.username as current_owner_username,
  -- Find the actual highest voted clip
  (SELECT c.user_id 
   FROM clips c 
   WHERE c.spot_id = s.id 
   ORDER BY c.vote_count DESC, c.created_at ASC 
   LIMIT 1) as should_be_owner_id,
  (SELECT p.username 
   FROM clips c 
   JOIN profiles p ON p.id = c.user_id
   WHERE c.spot_id = s.id 
   ORDER BY c.vote_count DESC, c.created_at ASC 
   LIMIT 1) as should_be_owner_username,
  -- Get the highest vote count
  (SELECT MAX(c.vote_count) 
   FROM clips c 
   WHERE c.spot_id = s.id) as highest_vote_count,
  COUNT(c.id) as total_clips
FROM spots s
LEFT JOIN profiles current_owner ON current_owner.id = s.owner_user_id  
LEFT JOIN clips c ON c.spot_id = s.id
GROUP BY s.id, s.title, s.owner_user_id, current_owner.username
HAVING COUNT(c.id) > 0
ORDER BY highest_vote_count DESC;

-- 2. Show clips with vote counts for specific investigation
SELECT 
  c.id as clip_id,
  c.spot_id,
  c.user_id,
  p.username,
  c.vote_count,
  c.created_at,
  s.title as spot_title
FROM clips c
LEFT JOIN profiles p ON p.id = c.user_id
LEFT JOIN spots s ON s.id = c.spot_id
ORDER BY c.vote_count DESC, c.created_at ASC;

-- 3. Check vote count integrity (compare stored vs actual votes)
SELECT 
  c.id as clip_id,
  c.user_id,
  p.username,
  c.vote_count as stored_votes,
  COUNT(v.id) as actual_votes,
  (c.vote_count = COUNT(v.id)) as counts_match
FROM clips c
LEFT JOIN profiles p ON p.id = c.user_id
LEFT JOIN votes v ON v.clip_id = c.id
GROUP BY c.id, c.user_id, p.username, c.vote_count
HAVING c.vote_count != COUNT(v.id)
ORDER BY c.vote_count DESC;

-- 4. Current leaderboard results
SELECT 'Current Leaderboard Results:' as debug_section;
SELECT * FROM get_leaderboard(20);

-- 5. Manual leaderboard calculation to compare
SELECT 'Manual Leaderboard Calculation:' as debug_section;
SELECT 
  p.id,
  p.username,
  p.display_name,
  p.avatar_url,
  COUNT(s.id) as spots_owned
FROM profiles p
LEFT JOIN spots s ON s.owner_user_id = p.id
GROUP BY p.id, p.username, p.display_name, p.avatar_url
HAVING COUNT(s.id) > 0
ORDER BY spots_owned DESC, p.username ASC
LIMIT 20;
