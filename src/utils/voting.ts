import { supabase } from '../../supabase';

export async function toggleVote(clipId: string): Promise<{ success: boolean; error?: string; newVoteCount?: number }> {
  try {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) {
      return { success: false, error: 'Not authenticated' };
    }

    console.log('Attempting to vote on clip:', clipId, 'by user:', userData.user.id);

    // Check if already voted - use maybeSingle() instead of single() to avoid errors
    const { data: existingVote, error: voteCheckError } = await supabase
      .from('votes')
      .select('*')
      .eq('clip_id', clipId)
      .eq('user_id', userData.user.id)
      .maybeSingle();

    if (voteCheckError) {
      console.error('Error checking existing vote:', voteCheckError);
      return { success: false, error: `Vote check failed: ${voteCheckError.message}` };
    }

    console.log('Existing vote check result:', existingVote);

    if (existingVote) {
      // Remove vote
      console.log('Removing existing vote:', existingVote.id);
      const { error: deleteError } = await supabase
        .from('votes')
        .delete()
        .eq('id', existingVote.id);

      if (deleteError) {
        console.error('Error deleting vote:', deleteError);
        return { success: false, error: `Failed to remove vote: ${deleteError.message}` };
      }
      console.log('Vote removed successfully');
    } else {
      // Add vote
      console.log('Adding new vote');
      const { error: insertError } = await supabase
        .from('votes')
        .insert([{
          clip_id: clipId,
          user_id: userData.user.id
        }]);

      if (insertError) {
        console.error('Error inserting vote:', insertError);
        return { success: false, error: `Failed to add vote: ${insertError.message}` };
      }
      console.log('Vote added successfully');
    }

    // Get updated vote count
    const { data: updatedClip, error: clipError } = await supabase
      .from('clips')
      .select('vote_count')
      .eq('id', clipId)
      .single();

    if (clipError) {
      console.error('Error getting updated clip data:', clipError);
      // Vote operation succeeded, but we can't get the new count
      return { success: true, error: 'Vote recorded but failed to get updated count' };
    }

    console.log('Updated vote count:', updatedClip.vote_count);
    return { success: true, newVoteCount: updatedClip.vote_count };

  } catch (error: any) {
    console.error('Unexpected voting error:', error);
    return { success: false, error: `Unexpected error: ${error.message}` };
  }
}
