# Leaderboard Fix Guide

## Issue Summary
The leaderboard is not showing users or mobs despite clips being uploaded and voted on. This is likely due to:

1. Missing database functions (`get_leaderboard`, `get_mob_leaderboard`) 
2. Missing mob-related tables (`mobs`, `mob_members`)
3. Spot ownership not being properly calculated when clips receive votes
4. Vote count triggers not working correctly

## Required Database Setup

### Step 1: Run the Missing Functions and Tables Script
Execute the SQL in `mob-maps/database/missing_functions_and_tables.sql` in your Supabase SQL editor. This will:

- Create the `mobs` and `mob_members` tables
- Create the `get_leaderboard()` and `get_mob_leaderboard()` functions
- Set up proper triggers for spot ownership calculation
- Fix any existing data inconsistencies

### Step 2: Run the Surveillance Table Script
Execute the SQL in `mob-maps/database/surveillance_table.sql` to set up surveillance citations properly.

### Step 3: Debug and Verify
Run the debug script in `mob-maps/database/debug_leaderboard_issues.sql` to:

- Check if spots have clips and proper ownership
- Verify vote counts are accurate
- Test the leaderboard functions
- Check mob membership data

## How Spot Ownership Works

1. When a user uploads a clip to a spot, the clip gets 0 votes initially
2. When users vote on clips, the `vote_count` field is updated via triggers
3. When a clip's vote count changes, the spot's `owner_user_id` is recalculated to be the user with the highest-voted clip at that spot
4. The leaderboard counts how many spots each user owns

## Expected Results After Fix

- **User Leaderboard**: Should show users who own spots (have the highest-voted clip at any spot)
- **Mob Leaderboard**: Should show mobs whose members collectively own spots
- **Spot Pin Colors**: Red pins for spots with clips, green for spots without clips
- **Surveillance Citations**: Should persist properly in the database

## Troubleshooting

If the leaderboard is still not working after running the SQL:

1. Check if your user profile exists in the `profiles` table
2. Verify that your clips have been voted on and have `vote_count > 0`
3. Check if the spot's `owner_user_id` field is set correctly
4. Ensure you're a member of a mob (create/join one via the My Mob screen)
5. Run the debug queries to identify specific issues

## Manual Fix for Existing Data

If you have existing data that's not showing up correctly, run this in Supabase SQL editor:

```sql
-- Fix vote counts for all clips
UPDATE clips SET vote_count = (
  SELECT COUNT(*) FROM votes WHERE clip_id = clips.id
);

-- Recalculate all spot owners
SELECT recalculate_all_spot_owners();
```

This will ensure all existing data is properly calculated and should fix any leaderboard display issues.
