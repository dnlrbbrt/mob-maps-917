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
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name, avatar_url, created_at)
  VALUES (NEW.id, NULL, NULL, NULL, NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;

-- Increment/decrement vote_count on clips table.
CREATE OR REPLACE FUNCTION public._vote_count_trigger()
RETURNS trigger AS $$
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
$$ LANGUAGE plpgsql;

-- Recalculate the spot owner based on the highest-voted clip.
CREATE OR REPLACE FUNCTION public._recalc_spot_owner()
RETURNS trigger AS $$
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
$$ LANGUAGE plpgsql;

-- Generate a random 6-character invite code.
CREATE OR REPLACE FUNCTION public.generate_invite_code()
RETURNS text AS $$
BEGIN
  RETURN upper(substr(md5(random()::text), 1, 6));
END;
$$ LANGUAGE plpgsql;

-- Add the mob owner as a member when a new mob is created.
CREATE OR REPLACE FUNCTION public.add_mob_owner_as_member()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.mob_members (mob_id, user_id, joined_at)
  VALUES (NEW.id, NEW.owner_user_id, NOW())
  ON CONFLICT (mob_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
REVOKE EXECUTE ON FUNCTION public.add_mob_owner_as_member() FROM anon, authenticated;

-- Get the user leaderboard based on spots owned.
CREATE OR REPLACE FUNCTION public.get_leaderboard(limit_count int DEFAULT 20)
RETURNS TABLE (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  spots_owned bigint
) AS $$
BEGIN
  SET search_path = '';
  RETURN QUERY
  SELECT p.id, p.username, p.display_name, p.avatar_url, COUNT(s.id)::bigint AS spots_owned
  FROM public.profiles p
  LEFT JOIN public.spots s ON s.owner_user_id = p.id
  GROUP BY p.id, p.username, p.display_name, p.avatar_url
  HAVING COUNT(s.id) > 0
  ORDER BY spots_owned DESC, p.username ASC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Get the mob leaderboard based on spots owned by members.
CREATE OR REPLACE FUNCTION public.get_mob_leaderboard(limit_count int DEFAULT 20)
RETURNS TABLE (
  mob_id uuid,
  mob_name text,
  total_spots_owned bigint,
  member_count bigint
) AS $$
BEGIN
  SET search_path = '';
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
$$ LANGUAGE plpgsql;

-- Recalculate all spot owners to ensure data integrity.
CREATE OR REPLACE FUNCTION public.recalculate_all_spot_owners()
RETURNS void AS $$
BEGIN
  UPDATE public.spots
  SET owner_user_id = (
    SELECT c.user_id FROM public.clips c
    WHERE c.spot_id = public.spots.id
    ORDER BY c.vote_count DESC, c.created_at ASC
    LIMIT 1
  ) WHERE EXISTS (SELECT 1 FROM public.clips WHERE spot_id = public.spots.id);
END;
$$ LANGUAGE plpgsql;

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
