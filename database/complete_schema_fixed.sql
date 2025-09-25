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
  owner_user_id uuid REFERENCES public.profiles(id),
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

-- ===================================================================
-- FIXED: Profiles RLS Policies (No conflicting INSERT policy)
-- ===================================================================
-- **CRITICAL**: REMOVE the old policies that were causing the conflict.
DROP POLICY IF EXISTS "Profiles insert own" ON public.profiles;
DROP POLICY IF EXISTS "Profiles select own" ON public.profiles;
DROP POLICY IF EXISTS "Profiles select all authenticated" ON public.profiles;
DROP POLICY IF EXISTS "Profiles update own" ON public.profiles;

-- **FIX**: Create new, correct policies.
-- Allow authenticated users to SEE all profiles.
CREATE POLICY "Profiles select all authenticated" ON public.profiles
  FOR SELECT TO authenticated USING (true);

-- Allow users to UPDATE their OWN profile.
CREATE POLICY "Profiles update own" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Spots: Publicly readable, but only authenticated users can create them.
DROP POLICY IF EXISTS "Spots select public" ON public.spots;
CREATE POLICY "Spots select public" ON public.spots
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Spots insert auth" ON public.spots;
CREATE POLICY "Spots insert auth" ON public.spots
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- Clips: Public can see non-flagged clips. Owners can see their own clips even if flagged.
DROP POLICY IF EXISTS "Clips select public" ON public.clips;
CREATE POLICY "Clips select public" ON public.clips
  FOR SELECT TO anon, authenticated USING ((flagged = false) OR (user_id = auth.uid()));

DROP POLICY IF EXISTS "Clips insert own" ON public.clips;
CREATE POLICY "Clips insert own" ON public.clips
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Clips update own" ON public.clips;
CREATE POLICY "Clips update own" ON public.clips
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Clips delete own" ON public.clips;
CREATE POLICY "Clips delete own" ON public.clips
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Votes: Authenticated users can see all votes, but can only manage their own.
DROP POLICY IF EXISTS "Votes select auth" ON public.votes;
CREATE POLICY "Votes select auth" ON public.votes
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Votes insert own" ON public.votes;
CREATE POLICY "Votes insert own" ON public.votes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Votes delete own" ON public.votes;
CREATE POLICY "Votes delete own" ON public.votes
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Surveillance: Publicly readable, but only owners can manage their entries.
DROP POLICY IF EXISTS "Surveillance select public" ON public.surveillance;
CREATE POLICY "Surveillance select public" ON public.surveillance
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Surveillance insert own" ON public.surveillance;
CREATE POLICY "Surveillance insert own" ON public.surveillance
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Surveillance update own" ON public.surveillance;
CREATE POLICY "Surveillance update own" ON public.surveillance
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Surveillance delete own" ON public.surveillance;
CREATE POLICY "Surveillance delete own" ON public.surveillance
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Mobs: Publicly readable, but only authenticated users can create them.
DROP POLICY IF EXISTS "mobs_select_all" ON public.mobs;
CREATE POLICY "mobs_select_all" ON public.mobs
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "mobs_insert_auth" ON public.mobs;
CREATE POLICY "mobs_insert_auth" ON public.mobs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_user_id);

-- Mob members: Publicly readable, but users can only add or remove themselves.
DROP POLICY IF EXISTS "mob_members_select_all" ON public.mob_members;
CREATE POLICY "mob_members_select_all" ON public.mob_members
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "mob_members_insert_auth" ON public.mob_members;
CREATE POLICY "mob_members_insert_auth" ON public.mob_members
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "mob_members_delete_own" ON public.mob_members;
CREATE POLICY "mob_members_delete_own" ON public.mob_members
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Spot Photos: Publicly readable, only authenticated users can manage
DROP POLICY IF EXISTS "spot_photos_select_public" ON public.spot_photos;
CREATE POLICY "spot_photos_select_public" ON public.spot_photos
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "spot_photos_insert_auth" ON public.spot_photos;
CREATE POLICY "spot_photos_insert_auth" ON public.spot_photos
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "spot_photos_delete_auth" ON public.spot_photos;
CREATE POLICY "spot_photos_delete_auth" ON public.spot_photos
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- Flags: Users can only see their own flags, admins can see all
DROP POLICY IF EXISTS "flags_select_own" ON public.flags;
CREATE POLICY "flags_select_own" ON public.flags
  FOR SELECT TO authenticated USING (
    auth.uid() = user_id OR 
    auth.email() = 'dnlrbbrt@gmail.com'
  );

DROP POLICY IF EXISTS "flags_insert_auth" ON public.flags;
CREATE POLICY "flags_insert_auth" ON public.flags
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "flags_delete_admin" ON public.flags;
CREATE POLICY "flags_delete_admin" ON public.flags
  FOR DELETE TO authenticated USING (auth.email() = 'dnlrbbrt@gmail.com');

-- =========================================================
-- STORAGE POLICIES
-- =========================================================

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

-- Get flagged content for admin dashboard
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
  RETURN QUERY
  SELECT 
    f.content_type,
    f.content_id,
    COUNT(f.id) as flag_count,
    MIN(f.created_at) as created_at,
    CASE 
      WHEN f.content_type = 'spot' THEN to_jsonb(s.*) 
      WHEN f.content_type = 'clip' THEN to_jsonb(c.*) || jsonb_build_object('profiles', to_jsonb(p.*))
      WHEN f.content_type = 'surveillance' THEN to_jsonb(sv.*)
      ELSE NULL::jsonb
    END as content_data
  FROM public.flags f
  LEFT JOIN public.spots s ON f.content_type = 'spot' AND f.content_id = s.id
  LEFT JOIN public.clips c ON f.content_type = 'clip' AND f.content_id = c.id
  LEFT JOIN public.profiles p ON c.user_id = p.id
  LEFT JOIN public.surveillance sv ON f.content_type = 'surveillance' AND f.content_id = sv.id
  GROUP BY f.content_type, f.content_id, s.*, c.*, p.*, sv.*
  ORDER BY flag_count DESC, created_at DESC;
END;
$$;

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

-- STEP 7: Ensure RLS policies allow proper vote management
-- Drop and recreate vote policies to ensure they work correctly
DROP POLICY IF EXISTS "Votes select auth" ON public.votes;
CREATE POLICY "Votes select auth" ON public.votes
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Votes insert own" ON public.votes;
CREATE POLICY "Votes insert own" ON public.votes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Votes delete own" ON public.votes;
CREATE POLICY "Votes delete own" ON public.votes
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

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
