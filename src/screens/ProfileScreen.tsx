import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Image, TextInput, ScrollView } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../supabase';
import { uploadImageFromUri } from '../lib/upload';
import { colors } from '../constants/colors';

type Profile = {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
};

export default function ProfileScreen({ navigation }: any) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [spotsOwned, setSpotsOwned] = useState(0);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    loadProfile();
    loadSpotsOwned();
    checkAdminStatus();
  }, []);

  async function checkAdminStatus() {
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (userData?.user?.email === 'dnlrbbrt@gmail.com') {
        setIsAdmin(true);
      }
    } catch (error) {
      console.error('Admin check error:', error);
    }
  }

  async function loadProfile() {
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user) return;

      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userData.user.id)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = not found
        console.error('Profile load error:', error);
        return;
      }

      if (profile) {
        setProfile(profile);
        setUsername(profile.username || '');
        setDisplayName(profile.display_name || '');
      } else {
        // Create profile if doesn't exist
        const newProfile = {
          id: userData.user.id,
          username: userData.user.email?.split('@')[0] || 'user',
          display_name: userData.user.email?.split('@')[0] || 'User',
          avatar_url: null
        };
        
        const { data, error: createError } = await supabase
          .from('profiles')
          .insert([newProfile])
          .select('*')
          .single();

        if (!createError && data) {
          setProfile(data);
          setUsername(data.username || '');
          setDisplayName(data.display_name || '');
        }
      }
    } catch (e: any) {
      console.error('loadProfile error:', e);
    }
  }

  async function loadSpotsOwned() {
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user) return;

      const { data, error } = await supabase
        .from('spots')
        .select('id')
        .eq('owner_user_id', userData.user.id);

      if (!error && data) {
        setSpotsOwned(data.length);
      }
    } catch (e: any) {
      console.error('loadSpotsOwned error:', e);
    }
  }

  async function updateProfile() {
    if (!profile || !username.trim()) {
      Alert.alert('Error', 'Username is required');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          username: username.trim(),
          display_name: displayName.trim() || username.trim()
        })
        .eq('id', profile.id);

      if (error) throw error;

      setProfile(prev => prev ? {
        ...prev,
        username: username.trim(),
        display_name: displayName.trim() || username.trim()
      } : null);

      setEditing(false);
      Alert.alert('Success', 'Profile updated!');
    } catch (e: any) {
      console.error('updateProfile error:', e);
      Alert.alert('Error', 'Failed to update profile: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function pickProfileImage() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
        allowsEditing: true,
        aspect: [1, 1]
      });

      if (!result.canceled && result.assets[0] && profile) {
        setLoading(true);
        const fileName = `${Date.now()}.jpg`;
        const storagePath = `avatars/${profile.id}/${fileName}`;
        
        await uploadImageFromUri('spots-photos', storagePath, result.assets[0].uri);
        
        const { error } = await supabase
          .from('profiles')
          .update({ avatar_url: storagePath })
          .eq('id', profile.id);

        if (error) throw error;

        setProfile(prev => prev ? { ...prev, avatar_url: storagePath } : null);
        Alert.alert('Success', 'Profile picture updated!');
      }
    } catch (e: any) {
      console.error('pickProfileImage error:', e);
      Alert.alert('Error', 'Failed to update profile picture: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  function getAvatarUrl() {
    if (!profile?.avatar_url) return null;
    return supabase.storage.from('spots-photos').getPublicUrl(profile.avatar_url).data.publicUrl;
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  if (!profile) {
    return (
      <View style={styles.container}>
        <Text style={styles.loading}>Loading profile...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={navigation.goBack} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Profile</Text>
        <TouchableOpacity onPress={signOut} style={styles.signOutButton}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.profileSection}>
        {/* Profile Picture */}
        <TouchableOpacity onPress={pickProfileImage} disabled={loading}>
          <View style={styles.avatarContainer}>
            {profile.avatar_url ? (
              <Image source={{ uri: getAvatarUrl() }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarText}>📷</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>

        {/* Username */}
        <View style={styles.fieldSection}>
          <Text style={styles.fieldLabel}>Username</Text>
          {editing ? (
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              placeholder="Enter username"
              autoCapitalize="none"
            />
          ) : (
            <Text style={styles.fieldValue}>@{profile.username || 'No username'}</Text>
          )}
        </View>

        {/* Display Name */}
        <View style={styles.fieldSection}>
          <Text style={styles.fieldLabel}>Display Name</Text>
          {editing ? (
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Enter display name"
            />
          ) : (
            <Text style={styles.fieldValue}>{profile.display_name || 'No display name'}</Text>
          )}
        </View>

        {/* Stats */}
        <View style={styles.statsSection}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{spotsOwned}</Text>
            <Text style={styles.statLabel}>Spots Owned</Text>
          </View>
        </View>

        {/* Admin Button */}
        {isAdmin && (
          <TouchableOpacity 
            style={[styles.button, styles.adminButton]} 
            onPress={() => navigation.navigate('Admin')}
          >
            <Text style={styles.buttonText}>🛡️ Admin Dashboard</Text>
          </TouchableOpacity>
        )}

        {/* Edit Button */}
        {editing ? (
          <View style={styles.buttonRow}>
            <TouchableOpacity 
              style={[styles.button, styles.saveButton]} 
              onPress={updateProfile}
              disabled={loading}
            >
              <Text style={styles.buttonText}>{loading ? 'Saving...' : 'Save Changes'}</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.button, styles.cancelButton]} 
              onPress={() => {
                setEditing(false);
                setUsername(profile.username || '');
                setDisplayName(profile.display_name || '');
              }}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={[styles.button, styles.editButton]} onPress={() => setEditing(true)}>
            <Text style={styles.buttonText}>Edit Profile</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingTop: 48, borderBottomWidth: 1, borderBottomColor: colors.border },
  backButton: { marginRight: 16 },
  backText: { fontSize: 16, color: colors.primary },
  title: { flex: 1, fontSize: 20, fontWeight: 'bold', color: colors.text },
  signOutButton: {},
  signOutText: { fontSize: 16, color: colors.error },
  loading: { textAlign: 'center', marginTop: 50, fontSize: 16, color: colors.textSecondary },
  
  profileSection: { padding: 20, alignItems: 'center' },
  avatarContainer: { marginBottom: 20 },
  avatar: { width: 100, height: 100, borderRadius: 50 },
  avatarPlaceholder: { width: 100, height: 100, borderRadius: 50, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 30 },
  
  fieldSection: { width: '100%', marginBottom: 20 },
  fieldLabel: { fontSize: 14, color: colors.textSecondary, marginBottom: 5, fontWeight: '500' },
  fieldValue: { fontSize: 18, color: colors.text, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  input: { borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 8, padding: 12, fontSize: 16, backgroundColor: colors.input, color: colors.text },
  
  statsSection: { width: '100%', marginVertical: 20 },
  statCard: { backgroundColor: colors.surface, padding: 20, borderRadius: 12, alignItems: 'center' },
  statNumber: { fontSize: 28, fontWeight: 'bold', color: colors.primary },
  statLabel: { fontSize: 14, color: colors.textSecondary, marginTop: 4 },
  
  buttonRow: { flexDirection: 'row', width: '100%', gap: 10 },
  button: { flex: 1, padding: 16, borderRadius: 8, alignItems: 'center', marginBottom: 10 },
  editButton: { backgroundColor: colors.primary, width: '100%' },
  adminButton: { backgroundColor: colors.error, width: '100%' },
  saveButton: { backgroundColor: colors.success },
  cancelButton: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  buttonText: { color: colors.text, fontSize: 16, fontWeight: 'bold' },
  cancelButtonText: { color: colors.textSecondary, fontSize: 16, fontWeight: 'bold' }
});
