-- Fix spot ownership and leaderboard issues

-- Step 1: First, let's recreate the spot ownership recalculation function without SET search_path
CREATE OR REPLACE FUNCTION public._recalc_spot_owner()
RETURNS trigger AS $$
DECLARE
  spot_to_update_id uuid;
BEGIN
  -- Determine which spot to update based on operation type
  IF (TG_OP = 'DELETE') THEN
    spot_to_update_id := OLD.spot_id;
  ELSE
    spot_to_update_id := NEW.spot_id;
  END IF;

  -- Update the spot owner to the user with the highest voted clip
  UPDATE public.spots
  SET owner_user_id = (
    SELECT c.user_id FROM public.clips c
    WHERE c.spot_id = spot_to_update_id
    ORDER BY c.vote_count DESC, c.created_at ASC
    LIMIT 1
  ) WHERE id = spot_to_update_id;

  -- Return appropriate record based on operation
  IF (TG_OP = 'DELETE') THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Recreate the vote count trigger function without SET search_path
CREATE OR REPLACE FUNCTION public._vote_count_trigger()
RETURNS trigger AS $$
BEGIN
  -- Update clip vote count based on operation
  IF (TG_OP = 'INSERT') THEN
    UPDATE public.clips SET vote_count = COALESCE(vote_count, 0) + 1 WHERE id = NEW.clip_id;
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE public.clips SET vote_count = GREATEST(COALESCE(vote_count, 0) - 1, 0) WHERE id = OLD.clip_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Step 3: Ensure all triggers exist and are working
DROP TRIGGER IF EXISTS trg_votes_after_insert ON public.votes;
CREATE TRIGGER trg_votes_after_insert
  AFTER INSERT ON public.votes
  FOR EACH ROW EXECUTE FUNCTION public._vote_count_trigger();

DROP TRIGGER IF EXISTS trg_votes_after_delete ON public.votes;
CREATE TRIGGER trg_votes_after_delete
  AFTER DELETE ON public.votes
  FOR EACH ROW EXECUTE FUNCTION public._vote_count_trigger();

-- Trigger when clip vote_count is updated
DROP TRIGGER IF EXISTS trg_clips_vote_update ON public.clips;
CREATE TRIGGER trg_clips_vote_update
  AFTER UPDATE OF vote_count ON public.clips
  FOR EACH ROW EXECUTE FUNCTION public._recalc_spot_owner();

-- Trigger when clips are inserted/deleted
DROP TRIGGER IF EXISTS trg_clips_after_insert ON public.clips;
CREATE TRIGGER trg_clips_after_insert
  AFTER INSERT ON public.clips
  FOR EACH ROW EXECUTE FUNCTION public._recalc_spot_owner();

DROP TRIGGER IF EXISTS trg_clips_after_delete ON public.clips;
CREATE TRIGGER trg_clips_after_delete
  AFTER DELETE ON public.clips
  FOR EACH ROW EXECUTE FUNCTION public._recalc_spot_owner();

-- Step 4: Fix any vote count discrepancies first
-- Recalculate all clip vote counts based on actual votes
UPDATE public.clips 
SET vote_count = (
  SELECT COUNT(*)::integer 
  FROM public.votes v 
  WHERE v.clip_id = clips.id
);

-- Step 5: Now recalculate all spot ownership based on corrected vote counts
UPDATE public.spots
SET owner_user_id = (
  SELECT c.user_id FROM public.clips c
  WHERE c.spot_id = public.spots.id
  ORDER BY c.vote_count DESC, c.created_at ASC
  LIMIT 1
) WHERE EXISTS (SELECT 1 FROM public.clips WHERE spot_id = public.spots.id);

-- Step 6: Verify the fix with some diagnostic queries
SELECT 'Spot ownership verification:' as info;
SELECT 
  s.id as spot_id,
  s.title,
  current_owner.username as current_owner,
  should_be.username as should_be_owner,
  (s.owner_user_id = should_be.user_id) as ownership_correct
FROM public.spots s
LEFT JOIN public.profiles current_owner ON current_owner.id = s.owner_user_id
LEFT JOIN (
  SELECT DISTINCT ON (c.spot_id) 
    c.spot_id, 
    c.user_id, 
    p.username,
    c.vote_count
  FROM public.clips c
  JOIN public.profiles p ON p.id = c.user_id
  ORDER BY c.spot_id, c.vote_count DESC, c.created_at ASC
) should_be ON should_be.spot_id = s.id
WHERE EXISTS (SELECT 1 FROM public.clips WHERE spot_id = s.id)
ORDER BY should_be.vote_count DESC;

-- Step 7: Show updated leaderboard
SELECT 'Updated leaderboard:' as info;
SELECT * FROM public.get_leaderboard(10);
