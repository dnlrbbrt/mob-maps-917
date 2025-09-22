-- surveillance: citations for tricks done at spots from video parts
create table surveillance (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid references spots(id) on delete cascade,
  user_id uuid references profiles(id),
  trick_name text not null,
  video_part text not null,
  created_at timestamptz default now()
);

-- Add index for faster queries by spot
create index idx_surveillance_spot_id on surveillance(spot_id);

-- Add index for faster queries by user
create index idx_surveillance_user_id on surveillance(user_id);

-- Enable RLS (Row Level Security)
alter table surveillance enable row level security;

-- Policy: Users can read all surveillance entries
create policy "Users can view surveillance" on surveillance for select using (true);

-- Policy: Only authenticated users can insert surveillance entries
create policy "Authenticated users can insert surveillance" on surveillance for insert with check (auth.uid() = user_id);

-- Policy: Users can delete their own surveillance entries
create policy "Users can delete own surveillance" on surveillance for delete using (auth.uid() = user_id);
