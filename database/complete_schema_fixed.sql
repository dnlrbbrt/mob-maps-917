-- =========================================================
-- COMPLETE DATABASE SCHEMA FOR MOB MAPS APP (Fixed)
-- =========================================================
-- Run this in your Supabase SQL editor

-- =========================================================
-- PROFILES
-- =========================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text UNIQUE,
  display_name text,
  avatar_url text,
  created_at timestamptz DEFAULT now()
);

-- =========================================================
-- SPOTS
-- =========================================================
CREATE TABLE IF NOT EXISTS public.spots (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  title text,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  photo_path text, -- Keep for backward compatibility
  owner_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- =========================================================
-- SPOT PHOTOS (Multiple photos per spot)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.spot_photos (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  spot_id uuid NOT NULL REFERENCES public.spots(id) ON DELETE CASCADE,
  photo_path text NOT NULL,
  display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- =========================================================
-- CLIPS
-- =========================================================
CREATE TABLE IF NOT EXISTS public.clips (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  spot_id uuid NOT NULL REFERENCES public.spots(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  thumb_path text,
  duration_seconds int,
  vote_count int DEFAULT 0,
  flagged boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- =========================================================
-- VOTES
-- =========================================================
CREATE TABLE IF NOT EXISTS public.votes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  clip_id uuid NOT NULL REFERENCES public.clips(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (clip_id, user_id)
);

-- =========================================================
-- SURVEILLANCE
-- =========================================================
CREATE TABLE IF NOT EXISTS public.surveillance (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  spot_id uuid NOT NULL REFERENCES public.spots(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  trick_name text NOT NULL,
  video_part text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- =========================================================
-- FLAGS (Content reporting)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.flags (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN ('spot', 'clip', 'surveillance')),
  content_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN ('inappropriate', 'not_a_spot', 'poor_quality', 'offensive', 'spam', 'other')),
  description text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, content_type, content_id)
);

-- =========================================================
-- MOBS & MOB_MEMBERS
-- =========================================================
CREATE TABLE IF NOT EXISTS public.mobs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  invite_code text UNIQUE NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now()
);

-- The UNIQUE constraint is already defined within this CREATE TABLE statement.
-- The separate ALTER TABLE statement that was causing the error has been removed.
CREATE TABLE IF NOT EXISTS public.mob_members (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  mob_id uuid NOT NULL REFERENCES public.mobs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  joined_at timestamptz DEFAULT now(),
  UNIQUE (mob_id, user_id)
);

-- =========================================================
-- INDEXES
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_spots_owner_user_id ON public.spots(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_spot_photos_spot_id ON public.spot_photos(spot_id);
CREATE INDEX IF NOT EXISTS idx_spot_photos_display_order ON public.spot_photos(spot_id, display_order);
CREATE INDEX IF NOT EXISTS idx_clips_spot_id ON public.clips(spot_id);
CREATE INDEX IF NOT EXISTS idx_clips_user_id ON public.clips(user_id);
CREATE INDEX IF NOT EXISTS idx_votes_clip_id ON public.votes(clip_id);
CREATE INDEX IF NOT EXISTS idx_votes_user_id ON public.votes(user_id);
CREATE INDEX IF NOT EXISTS idx_clips_vote_count_created_at ON public.clips(vote_count DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_flags_user_id ON public.flags(user_id);
CREATE INDEX IF NOT EXISTS idx_flags_content_type_id ON public.flags(content_type, content_id);
CREATE INDEX IF NOT EXISTS idx_flags_created_at ON public.flags(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mobs_invite_code ON public.mobs(invite_code);
CREATE INDEX IF NOT EXISTS idx_mob_members_mob_id ON public.mob_members(mob_id);
CREATE INDEX IF NOT EXISTS idx_mob_members_user_id ON public.mob_members(user_id);

-- =========================================================
-- FUNCTIONS
-- =========================================================

-- ===================================================================
-- FIXED: Create a profile for a new user (SECURITY DEFINER for RLS)
-- ===================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name, avatar_url, created_at)
  VALUES (NEW.id, NULL, NULL, NULL, NOW());
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;

-- Increment/decrement vote_count on clips table.
CREATE OR REPLACE FUNCTION public._vote_count_trigger()
RETURNS trigger 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE public.clips SET vote_count = COALESCE(vote_count, 0) + 1 WHERE id = NEW.clip_id;
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE public.clips SET vote_count = GREATEST(COALESCE(vote_count, 0) - 1, 0) WHERE id = OLD.clip_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

-- Recalculate the spot owner based on the highest-voted clip.
CREATE OR REPLACE FUNCTION public._recalc_spot_owner()
RETURNS trigger 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  spot_to_update_id uuid;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    spot_to_update_id := OLD.spot_id;
  ELSE
    spot_to_update_id := NEW.spot_id;
  END IF;

  UPDATE public.spots
  SET owner_user_id = (
    SELECT c.user_id FROM public.clips c
    WHERE c.spot_id = spot_to_update_id
    ORDER BY c.vote_count DESC, c.created_at ASC
    LIMIT 1
  ) WHERE id = spot_to_update_id;

  IF (TG_OP = 'DELETE') THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

-- Generate a random 6-character invite code.
CREATE OR REPLACE FUNCTION public.generate_invite_code()
RETURNS text 
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RETURN upper(substr(md5(random()::text), 1, 6));
END;
$$;

-- Add the mob owner as a member when a new mob is created.
CREATE OR REPLACE FUNCTION public.add_mob_owner_as_member()
RETURNS trigger 
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.mob_members (mob_id, user_id, joined_at)
  VALUES (NEW.id, NEW.owner_user_id, NOW())
  ON CONFLICT (mob_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.add_mob_owner_as_member() FROM anon, authenticated;

-- Get the user leaderboard based on spots owned.
CREATE OR REPLACE FUNCTION public.get_leaderboard(limit_count int DEFAULT 20)
RETURNS TABLE (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  spots_owned bigint
) 
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id, 
    p.username, 
    p.display_name, 
    p.avatar_url, 
    COALESCE(COUNT(s.id), 0)::bigint AS spots_owned
  FROM public.profiles p
  LEFT JOIN public.spots s ON s.owner_user_id = p.id AND s.owner_user_id IS NOT NULL
  GROUP BY p.id, p.username, p.display_name, p.avatar_url
  HAVING COALESCE(COUNT(s.id), 0) > 0
  ORDER BY spots_owned DESC, COALESCE(p.username, p.display_name, p.id::text) ASC
  LIMIT limit_count;
END;
$$;

-- Get the mob leaderboard based on spots owned by members.
CREATE OR REPLACE FUNCTION public.get_mob_leaderboard(limit_count int DEFAULT 20)
RETURNS TABLE (
  mob_id uuid,
  mob_name text,
  total_spots_owned bigint,
  member_count bigint
) 
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT m.id, m.name,
    COUNT(DISTINCT s.id)::bigint AS total_spots_owned,
    COUNT(DISTINCT mm.user_id)::bigint AS member_count
  FROM public.mobs m
  LEFT JOIN public.mob_members mm ON mm.mob_id = m.id
  LEFT JOIN public.spots s ON s.owner_user_id = mm.user_id
  GROUP BY m.id, m.name
  HAVING COUNT(DISTINCT s.id) > 0
  ORDER BY total_spots_owned DESC, m.name ASC
  LIMIT limit_count;
END;
$$;

-- Recalculate all spot owners to ensure data integrity.
CREATE OR REPLACE FUNCTION public.recalculate_all_spot_owners()
RETURNS void 
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  UPDATE public.spots
  SET owner_user_id = (
    SELECT c.user_id FROM public.clips c
    WHERE c.spot_id = public.spots.id
    ORDER BY c.vote_count DESC, c.created_at ASC
    LIMIT 1
  ) WHERE EXISTS (SELECT 1 FROM public.clips WHERE spot_id = public.spots.id);
END;
$$;

-- =========================================================
-- TRIGGERS
-- =========================================================
-- When a new user signs up in auth, create a profile.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- When a vote is inserted or deleted, update the clip's vote_count.
DROP TRIGGER IF EXISTS trg_votes_after_insert ON public.votes;
CREATE TRIGGER trg_votes_after_insert
  AFTER INSERT ON public.votes
  FOR EACH ROW EXECUTE FUNCTION public._vote_count_trigger();

DROP TRIGGER IF EXISTS trg_votes_after_delete ON public.votes;
CREATE TRIGGER trg_votes_after_delete
  AFTER DELETE ON public.votes
  FOR EACH ROW EXECUTE FUNCTION public._vote_count_trigger();

-- When a clip's vote_count is updated, recalculate the spot owner.
DROP TRIGGER IF EXISTS trg_clips_vote_update ON public.clips;
CREATE TRIGGER trg_clips_vote_update
  AFTER UPDATE OF vote_count ON public.clips
  FOR EACH ROW EXECUTE FUNCTION public._recalc_spot_owner();

-- When a clip is inserted or deleted, recalculate the spot owner.
DROP TRIGGER IF EXISTS trg_clips_after_insert ON public.clips;
CREATE TRIGGER trg_clips_after_insert
  AFTER INSERT ON public.clips
  FOR EACH ROW EXECUTE FUNCTION public._recalc_spot_owner();

DROP TRIGGER IF EXISTS trg_clips_after_delete ON public.clips;
CREATE TRIGGER trg_clips_after_delete
  AFTER DELETE ON public.clips
  FOR EACH ROW EXECUTE FUNCTION public._recalc_spot_owner();

-- When a mob is created, add its owner as the first member.
DROP TRIGGER IF EXISTS trigger_add_mob_owner ON public.mobs;
CREATE TRIGGER trigger_add_mob_owner
  AFTER INSERT ON public.mobs
  FOR EACH ROW EXECUTE FUNCTION public.add_mob_owner_as_member();

-- =========================================================
-- RLS POLICIES
-- =========================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.surveillance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mob_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spot_photos ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- PERFORMANCE OPTIMIZED RLS POLICIES
-- =========================================================
-- Drop all existing policies to start fresh with optimized versions
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT schemaname, tablename, policyname 
              FROM pg_policies 
              WHERE schemaname = 'public') 
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', 
                      r.policyname, r.schemaname, r.tablename);
    END LOOP;
END $$;

-- =========================================================
-- PROFILES POLICIES (OPTIMIZED)
-- =========================================================
CREATE POLICY "profiles_select_all" ON public.profiles
  FOR SELECT TO authenticated, anon
  USING (true);

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = id)
  WITH CHECK ((select auth.uid()) = id);

-- =========================================================
-- SPOTS POLICIES (OPTIMIZED)
-- =========================================================
CREATE POLICY "spots_select_all" ON public.spots
  FOR SELECT TO authenticated, anon
  USING (true);

CREATE POLICY "spots_insert_auth" ON public.spots
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) IS NOT NULL);

CREATE POLICY "spots_update_owner" ON public.spots
  FOR UPDATE TO authenticated
  USING (owner_user_id = (select auth.uid()))
  WITH CHECK (owner_user_id = (select auth.uid()));

CREATE POLICY "spots_delete_owner_or_admin" ON public.spots
  FOR DELETE TO authenticated
  USING (
    owner_user_id = (select auth.uid()) OR 
    (select auth.email()) = 'dnlrbbrt@gmail.com'
  );

-- =========================================================
-- SPOT_PHOTOS POLICIES (OPTIMIZED)
-- =========================================================
CREATE POLICY "spot_photos_select_all" ON public.spot_photos
  FOR SELECT TO authenticated, anon
  USING (true);

CREATE POLICY "spot_photos_insert_auth" ON public.spot_photos
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) IS NOT NULL);

CREATE POLICY "spot_photos_delete_auth" ON public.spot_photos
  FOR DELETE TO authenticated
  USING (
    (select auth.uid()) IS NOT NULL AND (
      (select auth.email()) = 'dnlrbbrt@gmail.com' OR
      EXISTS (
        SELECT 1 FROM public.spots s 
        WHERE s.id = spot_photos.spot_id 
        AND s.owner_user_id = (select auth.uid())
      )
    )
  );

-- =========================================================
-- CLIPS POLICIES (OPTIMIZED)
-- =========================================================
CREATE POLICY "clips_select_public_or_own" ON public.clips
  FOR SELECT TO authenticated, anon
  USING (
    flagged = false OR 
    user_id = (select auth.uid()) OR
    (select auth.email()) = 'dnlrbbrt@gmail.com'
  );

CREATE POLICY "clips_insert_own" ON public.clips
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "clips_update_own" ON public.clips
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "clips_delete_own_or_admin" ON public.clips
  FOR DELETE TO authenticated
  USING (
    (select auth.uid()) = user_id OR 
    (select auth.email()) = 'dnlrbbrt@gmail.com'
  );

-- =========================================================
-- VOTES POLICIES (OPTIMIZED)
-- =========================================================
CREATE POLICY "votes_select_auth" ON public.votes
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "votes_insert_own" ON public.votes
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "votes_delete_own" ON public.votes
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- =========================================================
-- SURVEILLANCE POLICIES (OPTIMIZED)
-- =========================================================
CREATE POLICY "surveillance_select_all" ON public.surveillance
  FOR SELECT TO authenticated, anon
  USING (true);

CREATE POLICY "surveillance_insert_own" ON public.surveillance
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "surveillance_update_own" ON public.surveillance
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "surveillance_delete_own_or_admin" ON public.surveillance
  FOR DELETE TO authenticated
  USING (
    (select auth.uid()) = user_id OR 
    (select auth.email()) = 'dnlrbbrt@gmail.com'
  );

-- =========================================================
-- FLAGS POLICIES (OPTIMIZED)
-- =========================================================
CREATE POLICY "flags_select_own_or_admin" ON public.flags
  FOR SELECT TO authenticated
  USING (
    (select auth.uid()) = user_id OR 
    (select auth.email()) = 'dnlrbbrt@gmail.com'
  );

CREATE POLICY "flags_insert_own" ON public.flags
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "flags_delete_admin" ON public.flags
  FOR DELETE TO authenticated
  USING ((select auth.email()) = 'dnlrbbrt@gmail.com');

-- =========================================================
-- MOBS POLICIES (OPTIMIZED)
-- =========================================================
CREATE POLICY "mobs_select_all" ON public.mobs
  FOR SELECT TO authenticated, anon
  USING (true);

CREATE POLICY "mobs_insert_auth" ON public.mobs
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = owner_user_id);

CREATE POLICY "mobs_update_owner" ON public.mobs
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = owner_user_id)
  WITH CHECK ((select auth.uid()) = owner_user_id);

CREATE POLICY "mobs_delete_owner_or_admin" ON public.mobs
  FOR DELETE TO authenticated
  USING (
    (select auth.uid()) = owner_user_id OR 
    (select auth.email()) = 'dnlrbbrt@gmail.com'
  );

-- =========================================================
-- MOB_MEMBERS POLICIES (OPTIMIZED)
-- =========================================================
CREATE POLICY "mob_members_select_all" ON public.mob_members
  FOR SELECT TO authenticated, anon
  USING (true);

CREATE POLICY "mob_members_insert_self" ON public.mob_members
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "mob_members_delete_self" ON public.mob_members
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- =========================================================
-- STORAGE POLICIES
-- =========================================================

-- =========================================================
-- MODERATION AND PERMANENT DELETION RPCS
-- =========================================================

-- Return storage paths for a clip (video + thumb)
CREATE OR REPLACE FUNCTION public.get_clip_storage_paths(target_clip_id uuid)
RETURNS TABLE (storage_path text, thumb_path text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT c.storage_path, c.thumb_path
  FROM public.clips c
  WHERE c.id = target_clip_id;
$$;
REVOKE EXECUTE ON FUNCTION public.get_clip_storage_paths(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_clip_storage_paths(uuid) TO authenticated;

-- Permanently delete a clip: remove related flags, then clip row
CREATE OR REPLACE FUNCTION public.delete_clip_permanently(target_clip_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.flags f
  WHERE f.content_type = 'clip' AND f.content_id = target_clip_id;

  DELETE FROM public.clips WHERE id = target_clip_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.delete_clip_permanently(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_clip_permanently(uuid) TO authenticated;

-- Return all storage paths associated with a spot (photos + clips + thumbs)
CREATE OR REPLACE FUNCTION public.get_spot_storage_paths(target_spot_id uuid)
RETURNS TABLE (bucket text, path text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT 'spots-photos'::text AS bucket, sp.photo_path AS path
  FROM public.spot_photos sp
  WHERE sp.spot_id = target_spot_id
  UNION ALL
  SELECT 'clips', c.storage_path
  FROM public.clips c
  WHERE c.spot_id = target_spot_id
  UNION ALL
  SELECT 'clips', c.thumb_path
  FROM public.clips c
  WHERE c.spot_id = target_spot_id AND c.thumb_path IS NOT NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.get_spot_storage_paths(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_spot_storage_paths(uuid) TO authenticated;

-- Permanently delete a spot: clean flags for spot and child clips, then delete spot
CREATE OR REPLACE FUNCTION public.delete_spot_permanently(target_spot_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.flags f
  WHERE f.content_type = 'spot' AND f.content_id = target_spot_id;

  DELETE FROM public.flags f
  WHERE f.content_type = 'clip'
    AND EXISTS (
      SELECT 1 FROM public.clips c
      WHERE c.id = f.content_id AND c.spot_id = target_spot_id
    );

  DELETE FROM public.spots WHERE id = target_spot_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.delete_spot_permanently(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_spot_permanently(uuid) TO authenticated;

-- Policies for 'spots-photos' bucket
DROP POLICY IF EXISTS "spots-photos public read" ON storage.objects;
CREATE POLICY "spots-photos public read" ON storage.objects
  FOR SELECT TO anon, authenticated USING (bucket_id = 'spots-photos');

DROP POLICY IF EXISTS "spots-photos auth upload" ON storage.objects;
CREATE POLICY "spots-photos auth upload" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'spots-photos');

-- Policies for 'clips' bucket
DROP POLICY IF EXISTS "clips public read" ON storage.objects;
CREATE POLICY "clips public read" ON storage.objects
  FOR SELECT TO anon, authenticated USING (bucket_id = 'clips');

DROP POLICY IF EXISTS "clips auth upload" ON storage.objects;
CREATE POLICY "clips auth upload" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'clips');

-- ===================================================================
-- FINAL STEP: BACKFILL PROFILES FOR ANY EXISTING USERS
-- This creates profiles for any users who failed to sign up before the fix.
-- ===================================================================
DO $$
DECLARE
    u RECORD;
    profile_count INTEGER := 0;
BEGIN
    FOR u IN
        SELECT au.id FROM auth.users au
        LEFT JOIN public.profiles p ON p.id = au.id
        WHERE p.id IS NULL
    LOOP
        INSERT INTO public.profiles (id, username, display_name, avatar_url, created_at) 
        VALUES (u.id, NULL, NULL, NULL, NOW());
        profile_count := profile_count + 1;
    END LOOP;
    RAISE NOTICE 'Successfully created % missing profiles.', profile_count;
END $$;

-- =========================================================
-- SPOT OWNERSHIP & LEADERBOARD FIX
-- =========================================================
-- Fix vote count discrepancies and spot ownership issues

-- =========================================================
-- COMPLETE FIX FOR ADMIN DASHBOARD
-- =========================================================
-- Drop the old function
DROP FUNCTION IF EXISTS public.get_flagged_content();
DROP FUNCTION IF EXISTS public.get_flagged_content_simple();

-- Create the corrected function that properly handles GROUP BY
CREATE OR REPLACE FUNCTION public.get_flagged_content()
RETURNS TABLE (
  content_type text,
  content_id uuid,
  flag_count bigint,
  created_at timestamptz,
  content_data jsonb
) 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Only allow admin access
  IF auth.email() != 'dnlrbbrt@gmail.com' THEN
    RAISE EXCEPTION 'Unauthorized: Admin access only';
  END IF;

  RETURN QUERY
  WITH flag_summary AS (
    SELECT 
      f.content_type,
      f.content_id,
      COUNT(f.id) as flag_count,
      MIN(f.created_at) as first_flagged
    FROM public.flags f
    GROUP BY f.content_type, f.content_id
  ),
  content_details AS (
    SELECT 
      fs.content_type,
      fs.content_id,
      fs.flag_count,
      fs.first_flagged,
      CASE 
        WHEN fs.content_type = 'spot' THEN 
          (SELECT to_jsonb(s.*) FROM public.spots s WHERE s.id = fs.content_id)
        WHEN fs.content_type = 'clip' THEN 
          (SELECT 
            to_jsonb(c.*) || 
            jsonb_build_object(
              'profiles', (
                SELECT to_jsonb(p.*) 
                FROM public.profiles p 
                WHERE p.id = c.user_id
              ),
              'thumb_path', COALESCE(c.thumb_path, ''),
              'safe_thumb_path', CASE 
                WHEN c.thumb_path IS NOT NULL AND c.thumb_path != '' 
                THEN c.thumb_path 
                ELSE NULL 
              END
            )
           FROM public.clips c 
           WHERE c.id = fs.content_id
          )
        WHEN fs.content_type = 'surveillance' THEN 
          (SELECT to_jsonb(sv.*) FROM public.surveillance sv WHERE sv.id = fs.content_id)
        ELSE 
          jsonb_build_object('id', fs.content_id, 'error', 'Content not found')
      END as content_data
    FROM flag_summary fs
  )
  SELECT 
    cd.content_type,
    cd.content_id,
    cd.flag_count,
    cd.first_flagged as created_at,
    COALESCE(
      cd.content_data, 
      jsonb_build_object(
        'id', cd.content_id,
        'thumb_path', '',
        'vote_count', 0,
        'profiles', jsonb_build_object('username', 'deleted')
      )
    ) as content_data
  FROM content_details cd
  WHERE cd.content_data IS NOT NULL
  ORDER BY cd.flag_count DESC, cd.first_flagged DESC;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_flagged_content() TO authenticated;

-- =========================================================
-- DEBUGGING FUNCTION FOR LEADERBOARD ISSUES
-- =========================================================
-- Temporary diagnostic function to check leaderboard data
CREATE OR REPLACE FUNCTION public.debug_leaderboard_data()
RETURNS TABLE (
  profile_id uuid,
  username text,
  display_name text,
  spots_count bigint,
  clips_count bigint,
  owned_spots text[]
) 
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id as profile_id,
    p.username,
    p.display_name,
    COUNT(DISTINCT s.id)::bigint as spots_count,
    COUNT(DISTINCT c.id)::bigint as clips_count,
    ARRAY_AGG(DISTINCT s.title) FILTER (WHERE s.title IS NOT NULL) as owned_spots
  FROM public.profiles p
  LEFT JOIN public.spots s ON s.owner_user_id = p.id
  LEFT JOIN public.clips c ON c.user_id = p.id
  GROUP BY p.id, p.username, p.display_name
  ORDER BY spots_count DESC, clips_count DESC;
END;
$$;

-- =========================================================
-- MIGRATION & SETUP FIXES
-- =========================================================

-- Step 1: Fix any vote count discrepancies first
-- Recalculate all clip vote counts based on actual votes
UPDATE public.clips 
SET vote_count = (
  SELECT COUNT(*)::integer 
  FROM public.votes v 
  WHERE v.clip_id = clips.id
);

-- Step 2: Recalculate all spot ownership based on corrected vote counts
UPDATE public.spots
SET owner_user_id = (
  SELECT c.user_id FROM public.clips c
  WHERE c.spot_id = public.spots.id
  ORDER BY c.vote_count DESC, c.created_at ASC
  LIMIT 1
) WHERE EXISTS (SELECT 1 FROM public.clips WHERE spot_id = public.spots.id);

-- Step 3: Migrate existing single photos to spot_photos table
INSERT INTO public.spot_photos (spot_id, photo_path, display_order)
SELECT id, photo_path, 0
FROM public.spots 
WHERE photo_path IS NOT NULL 
AND NOT EXISTS (
  SELECT 1 FROM public.spot_photos WHERE spot_id = spots.id
);

-- Step 4: Verify the fix with diagnostic query
DO $$
DECLARE
    spot_record RECORD;
    ownership_issues INTEGER := 0;
    migrated_photos INTEGER := 0;
BEGIN
    -- Check ownership issues
    FOR spot_record IN
        SELECT 
            s.id as spot_id,
            s.title,
            s.owner_user_id,
            (SELECT c.user_id FROM public.clips c
             WHERE c.spot_id = s.id 
             ORDER BY c.vote_count DESC, c.created_at ASC 
             LIMIT 1) as should_be_owner_id
        FROM public.spots s
        WHERE EXISTS (SELECT 1 FROM public.clips WHERE spot_id = s.id)
    LOOP
        IF spot_record.owner_user_id != spot_record.should_be_owner_id OR spot_record.owner_user_id IS NULL THEN
            ownership_issues := ownership_issues + 1;
        END IF;
    END LOOP;
    
    -- Count migrated photos
    SELECT COUNT(*) INTO migrated_photos FROM public.spot_photos;
    
    IF ownership_issues = 0 THEN
        RAISE NOTICE 'Spot ownership fix completed successfully. All spots have correct owners.';
    ELSE
        RAISE NOTICE 'Warning: % spots still have ownership issues after fix.', ownership_issues;
    END IF;
    
    RAISE NOTICE 'Photo migration completed. % photos migrated to spot_photos table.', migrated_photos;
END $$;

-- =========================================================
-- LEADERBOARD AND VOTING SYSTEM FIXES
-- =========================================================
-- These fixes ensure vote counts and spot ownership work correctly

-- STEP 1: Recreate vote count trigger function (without SET search_path issues)
CREATE OR REPLACE FUNCTION public._vote_count_trigger()
RETURNS trigger 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE public.clips SET vote_count = COALESCE(vote_count, 0) + 1 WHERE id = NEW.clip_id;
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE public.clips SET vote_count = GREATEST(COALESCE(vote_count, 0) - 1, 0) WHERE id = OLD.clip_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

-- STEP 2: Recreate spot ownership recalculation function
CREATE OR REPLACE FUNCTION public._recalc_spot_owner()
RETURNS trigger 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  spot_to_update_id uuid;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    spot_to_update_id := OLD.spot_id;
  ELSE
    spot_to_update_id := NEW.spot_id;
  END IF;

  UPDATE public.spots
  SET owner_user_id = (
    SELECT c.user_id FROM public.clips c
    WHERE c.spot_id = spot_to_update_id
    ORDER BY c.vote_count DESC, c.created_at ASC
    LIMIT 1
  ) WHERE id = spot_to_update_id;

  IF (TG_OP = 'DELETE') THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

-- STEP 3: Ensure all triggers exist and are working properly
DROP TRIGGER IF EXISTS trg_votes_after_insert ON public.votes;
CREATE TRIGGER trg_votes_after_insert
  AFTER INSERT ON public.votes
  FOR EACH ROW EXECUTE FUNCTION public._vote_count_trigger();

DROP TRIGGER IF EXISTS trg_votes_after_delete ON public.votes;
CREATE TRIGGER trg_votes_after_delete
  AFTER DELETE ON public.votes
  FOR EACH ROW EXECUTE FUNCTION public._vote_count_trigger();

DROP TRIGGER IF EXISTS trg_clips_vote_update ON public.clips;
CREATE TRIGGER trg_clips_vote_update
  AFTER UPDATE OF vote_count ON public.clips
  FOR EACH ROW EXECUTE FUNCTION public._recalc_spot_owner();

DROP TRIGGER IF EXISTS trg_clips_after_insert ON public.clips;
CREATE TRIGGER trg_clips_after_insert
  AFTER INSERT ON public.clips
  FOR EACH ROW EXECUTE FUNCTION public._recalc_spot_owner();

DROP TRIGGER IF EXISTS trg_clips_after_delete ON public.clips;
CREATE TRIGGER trg_clips_after_delete
  AFTER DELETE ON public.clips
  FOR EACH ROW EXECUTE FUNCTION public._recalc_spot_owner();

-- STEP 4: Fix any existing vote count discrepancies
UPDATE public.clips 
SET vote_count = (
  SELECT COUNT(*)::integer 
  FROM public.votes v 
  WHERE v.clip_id = clips.id
);

-- STEP 5: Recalculate all spot ownership based on corrected vote counts
UPDATE public.spots
SET owner_user_id = (
  SELECT c.user_id FROM public.clips c
  WHERE c.spot_id = public.spots.id
  ORDER BY c.vote_count DESC, c.created_at ASC
  LIMIT 1
) WHERE EXISTS (SELECT 1 FROM public.clips WHERE spot_id = public.spots.id);

-- STEP 6: Verification and diagnostic queries
DO $$
DECLARE
    vote_discrepancies INTEGER := 0;
    ownership_issues INTEGER := 0;
    total_users_on_leaderboard INTEGER := 0;
BEGIN
    -- Check for vote count discrepancies
    SELECT COUNT(*) INTO vote_discrepancies
    FROM (
        SELECT c.id
        FROM public.clips c
        LEFT JOIN public.votes v ON v.clip_id = c.id
        GROUP BY c.id, c.vote_count
        HAVING c.vote_count != COUNT(v.id)
    ) discrepancy_check;
    
    -- Check for spot ownership issues
    SELECT COUNT(*) INTO ownership_issues
    FROM public.spots s
    LEFT JOIN LATERAL (
        SELECT c.user_id
        FROM public.clips c
        WHERE c.spot_id = s.id
        ORDER BY c.vote_count DESC, c.created_at ASC
        LIMIT 1
    ) should_own ON true
    WHERE EXISTS (SELECT 1 FROM public.clips WHERE spot_id = s.id)
    AND (s.owner_user_id != should_own.user_id OR s.owner_user_id IS NULL);
    
    -- Check leaderboard results
    SELECT COUNT(*) INTO total_users_on_leaderboard
    FROM public.get_leaderboard(100);
    
    -- Report results
    IF vote_discrepancies = 0 THEN
        RAISE NOTICE 'Vote count fix completed successfully. All clips have correct vote counts.';
    ELSE
        RAISE NOTICE 'Warning: % clips still have vote count discrepancies.', vote_discrepancies;
    END IF;
    
    IF ownership_issues = 0 THEN
        RAISE NOTICE 'Spot ownership fix completed successfully. All spots have correct owners.';
    ELSE
        RAISE NOTICE 'Warning: % spots still have ownership issues.', ownership_issues;
    END IF;
    
    RAISE NOTICE 'Leaderboard now shows % users with owned spots.', total_users_on_leaderboard;
    
    IF vote_discrepancies = 0 AND ownership_issues = 0 AND total_users_on_leaderboard > 0 THEN
        RAISE NOTICE 'SUCCESS: Leaderboard and voting system fixes completed successfully!';
    ELSE
        RAISE NOTICE 'REVIEW NEEDED: Some issues may persist. Check individual user data.';
    END IF;
END $$;

-- =========================================================
-- VOTING SYSTEM ADDITIONAL FIXES
-- =========================================================
-- Additional fixes for voting issues on other users' clips

-- STEP 7: Vote policies already optimized above, no need to recreate

-- STEP 8: Create a helper function to debug voting issues
CREATE OR REPLACE FUNCTION public.debug_user_votes(user_uuid uuid DEFAULT auth.uid())
RETURNS TABLE (
  vote_id uuid,
  clip_id uuid,
  voter_username text,
  clip_owner_username text,
  vote_created_at timestamptz,
  clip_vote_count integer,
  actual_vote_count bigint
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    v.id as vote_id,
    v.clip_id,
    voter.username as voter_username,
    clip_owner.username as clip_owner_username,
    v.created_at as vote_created_at,
    c.vote_count as clip_vote_count,
    COUNT(all_votes.id) as actual_vote_count
  FROM public.votes v
  LEFT JOIN public.profiles voter ON voter.id = v.user_id
  LEFT JOIN public.clips c ON c.id = v.clip_id
  LEFT JOIN public.profiles clip_owner ON clip_owner.id = c.user_id
  LEFT JOIN public.votes all_votes ON all_votes.clip_id = c.id
  WHERE v.user_id = user_uuid
  GROUP BY v.id, v.clip_id, voter.username, clip_owner.username, v.created_at, c.vote_count
  ORDER BY v.created_at DESC;
END;
$$;

-- STEP 9: Create a function to test voting functionality
CREATE OR REPLACE FUNCTION public.test_vote_system(test_clip_id uuid, test_user_id uuid DEFAULT auth.uid())
RETURNS TABLE (
  action text,
  success boolean,
  vote_count_before integer,
  vote_count_after integer,
  error_message text
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    vote_before integer;
    vote_after integer;
    existing_vote_id uuid;
    test_error text;
BEGIN
    -- Get initial vote count
    SELECT c.vote_count INTO vote_before FROM public.clips c WHERE c.id = test_clip_id;
    
    -- Check if user already voted
    SELECT v.id INTO existing_vote_id 
    FROM public.votes v 
    WHERE v.clip_id = test_clip_id AND v.user_id = test_user_id;
    
    IF existing_vote_id IS NOT NULL THEN
        -- Remove existing vote
        BEGIN
            DELETE FROM public.votes WHERE id = existing_vote_id;
            SELECT c.vote_count INTO vote_after FROM public.clips c WHERE c.id = test_clip_id;
            RETURN QUERY SELECT 'remove_vote'::text, true, vote_before, vote_after, NULL::text;
        EXCEPTION WHEN OTHERS THEN
            RETURN QUERY SELECT 'remove_vote'::text, false, vote_before, vote_before, SQLERRM;
        END;
    ELSE
        -- Add new vote
        BEGIN
            INSERT INTO public.votes (clip_id, user_id) VALUES (test_clip_id, test_user_id);
            SELECT c.vote_count INTO vote_after FROM public.clips c WHERE c.id = test_clip_id;
            RETURN QUERY SELECT 'add_vote'::text, true, vote_before, vote_after, NULL::text;
        EXCEPTION WHEN OTHERS THEN
            RETURN QUERY SELECT 'add_vote'::text, false, vote_before, vote_before, SQLERRM;
        END;
    END IF;
END;
$$;

-- STEP 10: Final verification of voting system
DO $$
DECLARE
    vote_policy_count INTEGER := 0;
    trigger_count INTEGER := 0;
BEGIN
    -- Check that vote policies exist
    SELECT COUNT(*) INTO vote_policy_count
    FROM pg_policies 
    WHERE tablename = 'votes' AND schemaname = 'public';
    
    -- Check that vote triggers exist
    SELECT COUNT(*) INTO trigger_count
    FROM information_schema.triggers 
    WHERE trigger_schema = 'public' 
    AND (trigger_name LIKE '%vote%' OR event_object_table = 'votes');
    
    IF vote_policy_count >= 3 THEN
        RAISE NOTICE 'Vote RLS policies are properly configured (% policies found).', vote_policy_count;
    ELSE
        RAISE NOTICE 'WARNING: Vote RLS policies may be missing (only % policies found).', vote_policy_count;
    END IF;
    
    IF trigger_count >= 2 THEN
        RAISE NOTICE 'Vote triggers are properly configured (% triggers found).', trigger_count;
    ELSE
        RAISE NOTICE 'WARNING: Vote triggers may be missing (only % triggers found).', trigger_count;
    END IF;
    
    RAISE NOTICE 'Voting system fix completed. Use debug_user_votes() and test_vote_system() functions to test.';
END $$;

-- Enforce one vote per spot per user via secure RPC
DROP FUNCTION IF EXISTS public.cast_vote(uuid);
CREATE OR REPLACE FUNCTION public.cast_vote(target_clip_id uuid)
RETURNS TABLE (
  action text,
  voted_clip_id uuid,
  new_vote_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  target_spot_id uuid;
  existing_vote_id uuid;
  existing_vote_clip_id uuid;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Validate target clip and get its spot
  SELECT c.spot_id INTO target_spot_id
  FROM public.clips c
  WHERE c.id = target_clip_id;

  IF target_spot_id IS NULL THEN
    RAISE EXCEPTION 'Invalid clip_id';
  END IF;

  -- Find any existing vote by this user on this spot
  SELECT v.id, v.clip_id
  INTO existing_vote_id, existing_vote_clip_id
  FROM public.votes v
  JOIN public.clips c ON c.id = v.clip_id
  WHERE v.user_id = current_user_id
    AND c.spot_id = target_spot_id
  LIMIT 1;

  IF existing_vote_id IS NOT NULL THEN
    IF existing_vote_clip_id = target_clip_id THEN
      -- Toggle off (remove vote on same clip)
      DELETE FROM public.votes WHERE id = existing_vote_id;
      RETURN QUERY
      SELECT 'removed'::text,
             target_clip_id,
             (SELECT vote_count FROM public.clips WHERE id = target_clip_id);
      RETURN;
    ELSE
      -- Move vote: remove old, add new
      DELETE FROM public.votes WHERE id = existing_vote_id;
      INSERT INTO public.votes (clip_id, user_id) VALUES (target_clip_id, current_user_id)
      ON CONFLICT (clip_id, user_id) DO NOTHING;
      RETURN QUERY
      SELECT 'moved'::text,
             target_clip_id,
             (SELECT vote_count FROM public.clips WHERE id = target_clip_id);
      RETURN;
    END IF;
  ELSE
    -- No existing vote on this spot: add new vote
    INSERT INTO public.votes (clip_id, user_id) VALUES (target_clip_id, current_user_id)
    ON CONFLICT (clip_id, user_id) DO NOTHING;
    RETURN QUERY
    SELECT 'added'::text,
           target_clip_id,
           (SELECT vote_count FROM public.clips WHERE id = target_clip_id);
    RETURN;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.cast_vote(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.cast_vote(uuid) TO authenticated;

-- Test the get_flagged_content function to make sure it works
DO $$
BEGIN
  RAISE NOTICE 'Testing get_flagged_content function...';
  
  -- This will only work if you're logged in as admin
  IF EXISTS (
    SELECT 1 FROM auth.users 
    WHERE id = auth.uid() 
    AND email = 'dnlrbbrt@gmail.com'
  ) THEN
    PERFORM * FROM public.get_flagged_content() LIMIT 1;
    RAISE NOTICE 'Function test completed successfully';
  ELSE
    RAISE NOTICE 'Skipping test - not logged in as admin';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Function test failed: %', SQLERRM;
END $$;

-- =========================================================
-- VERIFY RLS OPTIMIZATION
-- =========================================================
DO $$
DECLARE
    unoptimized_count INTEGER := 0;
    duplicate_count INTEGER := 0;
    table_name TEXT;
    policy_info RECORD;
BEGIN
    RAISE NOTICE 'Verifying RLS policy optimizations...';
    
    -- Check for unoptimized auth function calls
    FOR policy_info IN 
        SELECT tablename, policyname, qual, with_check
        FROM pg_policies 
        WHERE schemaname = 'public'
        AND (
            (qual LIKE '%auth.uid()%' AND qual NOT LIKE '%(select auth.uid())%')
            OR (with_check LIKE '%auth.uid()%' AND with_check NOT LIKE '%(select auth.uid())%')
            OR (qual LIKE '%auth.email()%' AND qual NOT LIKE '%(select auth.email())%')
            OR (with_check LIKE '%auth.email()%' AND with_check NOT LIKE '%(select auth.email())%')
        )
    LOOP
        unoptimized_count := unoptimized_count + 1;
        RAISE WARNING 'Unoptimized policy: %.% - qual=%, with_check=%', 
                      policy_info.tablename, policy_info.policyname, policy_info.qual, policy_info.with_check;
    END LOOP;
    
    -- Check for duplicate policies (simplified check)
    FOR policy_info IN
        SELECT tablename, roles, cmd, COUNT(*) as policy_count
        FROM pg_policies
        WHERE schemaname = 'public'
        GROUP BY tablename, roles, cmd
        HAVING COUNT(*) > 1
    LOOP
        duplicate_count := duplicate_count + 1;
        RAISE WARNING 'Duplicate policies found: % has % policies for same role/action (%)', 
                      policy_info.tablename, policy_info.policy_count, policy_info.cmd;
    END LOOP;
    
    IF unoptimized_count = 0 AND duplicate_count = 0 THEN
        RAISE NOTICE 'SUCCESS: All RLS policies are optimized!';
        RAISE NOTICE 'No auth function re-evaluation issues found.';
        RAISE NOTICE 'No duplicate policies found.';
    ELSE
        RAISE WARNING 'ISSUES FOUND: % unoptimized policies, % duplicate policy sets', 
                      unoptimized_count, duplicate_count;
    END IF;
    
    -- Summary of policies per table
    RAISE NOTICE '';
    RAISE NOTICE 'Policy Summary by Table:';
    FOR policy_info IN
        SELECT tablename, COUNT(*) as policy_count
        FROM pg_policies
        WHERE schemaname = 'public'
        GROUP BY tablename
        ORDER BY tablename
    LOOP
        RAISE NOTICE '  %: % policies', policy_info.tablename, policy_info.policy_count;
    END LOOP;
    
    RAISE NOTICE '';
    RAISE NOTICE 'RLS optimization verification completed.';
END $$;
