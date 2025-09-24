import { supabase } from '../../supabase';

export async function runDatabaseDiagnostics() {
  console.log('🔍 Running database diagnostics...');
  
  try {
    // Test 1: Check authentication
    console.log('1. Checking authentication...');
    const { data: userData, error: authError } = await supabase.auth.getUser();
    if (authError) {
      console.error('❌ Auth error:', authError);
      return { success: false, error: 'Authentication failed: ' + authError.message };
    }
    
    if (!userData?.user) {
      console.error('❌ No authenticated user found');
      return { success: false, error: 'No authenticated user found' };
    }
    
    console.log('✅ User authenticated:', userData.user.id);
    
    // Test 2: Check if profiles table exists and is accessible
    console.log('2. Checking profiles table...');
    const { data: profileCheck, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .limit(1);
    
    if (profileError) {
      console.error('❌ Profiles table error:', profileError);
      return { success: false, error: 'Profiles table not accessible: ' + profileError.message };
    }
    
    console.log('✅ Profiles table accessible');
    
    // Test 3: Check if user's profile exists
    console.log('3. Checking user profile...');
    const { data: userProfile, error: userProfileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userData.user.id)
      .single();
    
    if (userProfileError && userProfileError.code !== 'PGRST116') {
      console.error('❌ User profile check error:', userProfileError);
      return { success: false, error: 'Profile check failed: ' + userProfileError.message };
    }
    
    if (!userProfile) {
      console.log('⚠️ User profile does not exist, attempting to create...');
      
      // Test 4: Try to create profile
      const { data: newProfile, error: createError } = await supabase
        .from('profiles')
        .insert([{
          id: userData.user.id,
          username: userData.user.email?.split('@')[0] || 'user',
          display_name: userData.user.email?.split('@')[0] || 'User'
        }])
        .select('*')
        .single();
      
      if (createError) {
        console.error('❌ Profile creation failed:', createError);
        return { success: false, error: 'Profile creation failed: ' + createError.message };
      }
      
      console.log('✅ Profile created successfully:', newProfile);
      return { success: true, message: 'Profile created successfully', profile: newProfile };
    } else {
      console.log('✅ User profile exists:', userProfile);
      
      // Test 5: Try to update profile (the actual failing operation)
      console.log('4. Testing profile update...');
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ display_name: userProfile.display_name || 'Test User' })
        .eq('id', userData.user.id);
      
      if (updateError) {
        console.error('❌ Profile update failed:', updateError);
        return { success: false, error: 'Profile update failed: ' + updateError.message };
      }
      
      console.log('✅ Profile update successful');
      return { success: true, message: 'All tests passed', profile: userProfile };
    }
    
  } catch (error: any) {
    console.error('❌ Diagnostic error:', error);
    return { success: false, error: 'Diagnostic failed: ' + error.message };
  }
}
