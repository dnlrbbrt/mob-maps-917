import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Image, TextInput, ScrollView } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../supabase';
import { uploadImageFromUri } from '../lib/upload';

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

  useEffect(() => {
    loadProfile();
    loadSpotsOwned();
  }, []);

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
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingTop: 48, borderBottomWidth: 1, borderBottomColor: '#eee' },
  backButton: { marginRight: 16 },
  backText: { fontSize: 16, color: '#007AFF' },
  title: { flex: 1, fontSize: 20, fontWeight: 'bold' },
  signOutButton: {},
  signOutText: { fontSize: 16, color: '#FF3B30' },
  loading: { textAlign: 'center', marginTop: 50, fontSize: 16, color: '#666' },
  
  profileSection: { padding: 20, alignItems: 'center' },
  avatarContainer: { marginBottom: 20 },
  avatar: { width: 100, height: 100, borderRadius: 50 },
  avatarPlaceholder: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#f0f0f0', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 30 },
  
  fieldSection: { width: '100%', marginBottom: 20 },
  fieldLabel: { fontSize: 14, color: '#666', marginBottom: 5, fontWeight: '500' },
  fieldValue: { fontSize: 18, color: '#333', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, fontSize: 16 },
  
  statsSection: { width: '100%', marginVertical: 20 },
  statCard: { backgroundColor: '#f8f8f8', padding: 20, borderRadius: 12, alignItems: 'center' },
  statNumber: { fontSize: 28, fontWeight: 'bold', color: '#007AFF' },
  statLabel: { fontSize: 14, color: '#666', marginTop: 4 },
  
  buttonRow: { flexDirection: 'row', width: '100%', gap: 10 },
  button: { flex: 1, padding: 16, borderRadius: 8, alignItems: 'center' },
  editButton: { backgroundColor: '#007AFF', width: '100%' },
  saveButton: { backgroundColor: '#34C759' },
  cancelButton: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  cancelButtonText: { color: '#666', fontSize: 16, fontWeight: 'bold' }
});
