import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Image, Dimensions, TextInput } from 'react-native';
// Camera removed - only using library picker
import { Video, ResizeMode } from 'expo-av';
import * as VideoThumbnails from 'expo-video-thumbnails';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../supabase';
import { uploadImageFromUri } from '../lib/upload';
import { colors } from '../constants/colors';

const { width } = Dimensions.get('window');

type Clip = {
  id: string;
  user_id: string;
  storage_path: string;
  thumb_path?: string;
  vote_count: number;
  created_at: string;
  profiles?: {
    username: string;
    display_name: string;
  };
};

export default function SpotScreen({ route, navigation }: any) {
  const { spot } = route.params;
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(false);

  // Video playback state
  const [playingClipId, setPlayingClipId] = useState<string | null>(null);

  // Surveillance state
  const [trickName, setTrickName] = useState('');
  const [videoPart, setVideoPart] = useState('');
  const [surveillance, setSurveillance] = useState<any[]>([]);

  useEffect(() => {
    loadClips();
    loadSurveillance();
  }, []);

  async function loadClips() {
    const { data } = await supabase
      .from('clips')
      .select(`
        *,
        profiles:user_id (
          username,
          display_name
        )
      `)
      .eq('spot_id', spot.id)
      .order('vote_count', { ascending: false });
    setClips(data || []);
  }

  async function loadSurveillance() {
    try {
      const { data } = await supabase
        .from('surveillance')
        .select('*')
        .eq('spot_id', spot.id)
        .order('created_at', { ascending: false });
      setSurveillance(data || []);
    } catch (error) {
      console.error('Error loading surveillance:', error);
      setSurveillance([]); // Fallback to empty array
    }
  }

  async function pickVideoFromLibrary() {
    try {
      console.log('Opening video library...');
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        quality: 0.8,
        allowsEditing: true,
        videoMaxDuration: 10
      });
      
      console.log('Library result:', result);
      
      if (!result.canceled && result.assets[0]) {
        console.log('Selected video URI:', result.assets[0].uri);
        await uploadClip(result.assets[0].uri);
      } else {
        console.log('Video selection canceled or no asset');
      }
    } catch (e: any) {
      console.error('pickVideoFromLibrary error:', e);
      Alert.alert('Error', 'Failed to open video library: ' + e.message);
    }
  }

  // Recording functionality removed - only using library picker

  async function uploadClip(videoUri: string) {
    setLoading(true);
    try {
      console.log('Starting upload for video:', videoUri);
      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user) throw new Error('Not authenticated');

      console.log('User ID:', userData.user.id);

      // Check if profile exists
      const { data: existingProfile, error: profileCheckError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', userData.user.id)
        .single();

      console.log('Existing profile check:', existingProfile, profileCheckError);

      if (!existingProfile) {
        console.log('Creating new profile...');
        const { data: newProfile, error: profileCreateError } = await supabase
          .from('profiles')
          .insert([{
            id: userData.user.id,
            username: userData.user.email?.split('@')[0] || 'user',
            display_name: userData.user.email?.split('@')[0] || 'User'
          }])
          .select('*');

        console.log('Profile creation result:', newProfile, profileCreateError);
        
        if (profileCreateError) {
          throw new Error(`Failed to create profile: ${profileCreateError.message}`);
        }
        
        // Refresh clips after profile creation to show correct username
        await loadClips();
      }

      const videoFileName = `${Date.now()}.mp4`;
      const videoPath = `clips/${spot.id}/${videoFileName}`;
      
      console.log('Creating thumbnail...');
      // Create thumbnail
      const thumb = await VideoThumbnails.getThumbnailAsync(videoUri, { time: 0 });
      const thumbFileName = `${Date.now()}_thumb.jpg`;
      const thumbPath = `clips/thumbs/${thumbFileName}`;

      console.log('Uploading video and thumbnail...');
      // Upload video and thumbnail
      await uploadVideoFromUri('clips', videoPath, videoUri);
      await uploadImageFromUri('clips', thumbPath, thumb.uri);

      console.log('Inserting clip record...');
      // Insert clip record
      const { data, error } = await supabase.from('clips').insert([{
        spot_id: spot.id,
        user_id: userData.user.id,
        storage_path: videoPath,
        thumb_path: thumbPath,
        duration_seconds: 10
      }]).select('*');

      if (error) {
        console.error('Clip insert error:', error);
        throw error;
      }
      
      console.log('Clip uploaded successfully:', data);
      setClips(prev => [data![0], ...prev]);
      Alert.alert('Success', 'Clip uploaded!');
    } catch (e: any) {
      console.error('uploadClip error', e);
      Alert.alert('Upload failed', e.message || JSON.stringify(e));
    } finally {
      setLoading(false);
    }
  }

  async function uploadVideoFromUri(bucket: string, storagePath: string, uri: string) {
    // Similar to uploadImageFromUri but for video
    const extra = require('expo-constants').default.expoConfig?.extra;
    const baseUrl = extra.SUPABASE_URL;
    const anon = extra.SUPABASE_ANON_KEY;
    
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) throw new Error('Not authenticated');

    const form = new FormData();
    form.append('file', { uri, name: storagePath.split('/').pop(), type: 'video/mp4' } as any);
    
    const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/');
    const endpoint = `${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`;
    
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: anon,
        'x-upsert': 'false'
      } as any,
      body: form
    });
    
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(text || `Upload failed: ${resp.status}`);
    }
  }

  async function vote(clipId: string) {
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user) throw new Error('Not authenticated');

      // Check if already voted
      const { data: existingVote } = await supabase
        .from('votes')
        .select('*')
        .eq('clip_id', clipId)
        .eq('user_id', userData.user.id)
        .single();

      if (existingVote) {
        // Remove vote
        await supabase.from('votes').delete().eq('id', existingVote.id);
      } else {
        // Add vote
        await supabase.from('votes').insert([{
          clip_id: clipId,
          user_id: userData.user.id
        }]);
      }

      loadClips(); // Refresh to show updated vote counts
    } catch (e: any) {
      Alert.alert('Vote failed', e.message);
    }
  }

  function playClip(clipId: string) {
    setPlayingClipId(playingClipId === clipId ? null : clipId);
  }

  async function addSurveillance() {
    if (!trickName || !videoPart) return Alert.alert('Missing info', 'Please enter both trick and video part');
    
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user) {
        Alert.alert('Not signed in', 'Please sign in before adding surveillance.');
        return;
      }

      const { data, error } = await supabase
        .from('surveillance')
        .insert([{
          spot_id: spot.id,
          user_id: userData.user.id,
          trick_name: trickName,
          video_part: videoPart
        }])
        .select('*');

      if (error) throw error;

      setSurveillance(prev => [data![0], ...prev]);
      setTrickName('');
      setVideoPart('');
      Alert.alert('Added', 'Surveillance entry added!');
    } catch (e: any) {
      console.error('addSurveillance error', e);
      Alert.alert('Error', `Failed to add surveillance: ${e.message}`);
    }
  }

  function getSpotImageUrl() {
    if (!spot.photo_path) return null;
    return supabase.storage.from('spots-photos').getPublicUrl(spot.photo_path).data.publicUrl;
  }

  // Show all clips with rankings
  const rankedClips = clips;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={navigation.goBack} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{spot.title || 'Spot'}</Text>
      </View>
      
      <ScrollView style={styles.scrollContainer}>
        {/* Spot Photo */}
        <View style={styles.spotPhotoSection}>
          {spot.photo_path && getSpotImageUrl() ? (
            <Image source={{ uri: getSpotImageUrl()! }} style={styles.spotPhoto} />
          ) : (
            <View style={styles.noPhotoPlaceholder}>
              <Text style={styles.noPhotoText}>No photo available</Text>
            </View>
          )}
        </View>

        {/* All Clips */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🎥 All Clips</Text>
          {rankedClips.length === 0 ? (
            <Text style={styles.noClips}>No clips yet. Be the first to battle!</Text>
          ) : (
            rankedClips.map((clip, index) => (
              <View key={clip.id} style={styles.clipCard}>
                <Text style={styles.clipRank}>#{index + 1}</Text>
                <TouchableOpacity onPress={() => playClip(clip.id)} style={styles.thumbnailContainer}>
                  {playingClipId === clip.id ? (
                    <Video
                      source={{ uri: `${supabase.storage.from('clips').getPublicUrl(clip.storage_path).data.publicUrl}` }}
                      style={styles.videoPlayer}
                      resizeMode={ResizeMode.CONTAIN}
                      shouldPlay={true}
                      isLooping={true}
                      useNativeControls={true}
                      onError={(error) => {
                        console.error('Video error:', error);
                        setPlayingClipId(null);
                      }}
                    />
                  ) : (
                    clip.thumb_path && (
                      <Image
                        source={{ uri: `${supabase.storage.from('clips').getPublicUrl(clip.thumb_path).data.publicUrl}` }}
                        style={styles.thumbnail}
                      />
                    )
                  )}
                  {!playingClipId || playingClipId !== clip.id ? (
                    <View style={styles.playOverlay}>
                      <Text style={styles.playIcon}>▶️</Text>
                    </View>
                  ) : null}
                </TouchableOpacity>
                <View style={styles.clipInfo}>
                  <View style={styles.clipDetails}>
                    <Text style={styles.username}>@{clip.profiles?.username || 'anonymous'}</Text>
                    <Text style={styles.voteCount}>❤️ {clip.vote_count}</Text>
                  </View>
                  <TouchableOpacity style={styles.voteButton} onPress={() => vote(clip.id)}>
                    <Text style={styles.voteText}>Vote</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </View>

        {/* Upload Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📹 Upload Your Clip</Text>
          <Text style={styles.sectionSubtitle}>Upload a video to battle for this spot</Text>
          <TouchableOpacity style={styles.uploadButton} onPress={pickVideoFromLibrary} disabled={loading}>
            <Text style={styles.uploadButtonText}>
              {loading ? 'Uploading...' : '📱 Pick Video from Library'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Surveillance Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>👁️ Surveillance</Text>
          <Text style={styles.sectionSubtitle}>Cite tricks done at this spot from video parts</Text>
          
          <View style={styles.surveillanceForm}>
            <TextInput
              style={styles.input}
              placeholder="Trick name (e.g., kickflip backside lipslide)"
              placeholderTextColor={colors.textTertiary}
              value={trickName}
              onChangeText={setTrickName}
            />
            <TextInput
              style={styles.input}
              placeholder="Video part (e.g., Baker 3, Koston in Menikmati)"
              placeholderTextColor={colors.textTertiary}
              value={videoPart}
              onChangeText={setVideoPart}
            />
            <TouchableOpacity style={styles.addButton} onPress={addSurveillance}>
              <Text style={styles.addButtonText}>Add Citation</Text>
            </TouchableOpacity>
          </View>

          {surveillance.map((entry) => (
            <View key={entry.id} style={styles.surveillanceEntry}>
              <Text style={styles.trickText}>{entry.trick_name}</Text>
              <Text style={styles.videoPartText}>{entry.video_part}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingTop: 48, borderBottomWidth: 1, borderBottomColor: colors.border },
  backButton: { marginRight: 16 },
  backText: { fontSize: 16, color: colors.primary },
  title: { flex: 1, fontSize: 20, fontWeight: 'bold', color: colors.text },
  scrollContainer: { flex: 1 },
  
  // Spot photo section
  spotPhotoSection: { padding: 16 },
  spotPhoto: { width: '100%', height: 200, borderRadius: 12 },
  noPhotoPlaceholder: { width: '100%', height: 200, backgroundColor: colors.surface, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  noPhotoText: { color: colors.textSecondary, fontSize: 16 },
  
  // Section styles
  section: { padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 8, color: colors.text },
  sectionSubtitle: { fontSize: 14, color: colors.textSecondary, marginBottom: 16 },
  
  // Clips
  noClips: { textAlign: 'center', color: colors.textSecondary, fontSize: 16, fontStyle: 'italic' },
  clipCard: { flexDirection: 'row', marginBottom: 12, backgroundColor: colors.surface, borderRadius: 8, padding: 12, alignItems: 'center' },
  clipRank: { fontSize: 18, fontWeight: 'bold', color: colors.primary, marginRight: 12, minWidth: 30 },
  thumbnailContainer: { position: 'relative' },
  thumbnail: { width: 80, height: 60, borderRadius: 4 },
  videoPlayer: { width: 80, height: 60, borderRadius: 4 },
  playOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 4 },
  playIcon: { fontSize: 20 },
  clipInfo: { flex: 1, marginLeft: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  clipDetails: { flex: 1 },
  username: { fontSize: 14, color: colors.primary, fontWeight: '500', marginBottom: 2 },
  voteCount: { fontSize: 16, fontWeight: 'bold', color: colors.text },
  voteButton: { backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 4 },
  voteText: { color: colors.text, fontWeight: 'bold', fontSize: 12 },
  
  // Upload section
  uploadButton: { backgroundColor: colors.error, padding: 16, borderRadius: 8, alignItems: 'center' },
  uploadButtonText: { color: colors.text, fontSize: 16, fontWeight: 'bold' },
  
  // Surveillance section
  surveillanceForm: { marginBottom: 16 },
  input: { 
    borderWidth: 1, 
    borderColor: colors.inputBorder, 
    backgroundColor: colors.input,
    borderRadius: 8, 
    padding: 12, 
    marginBottom: 8, 
    fontSize: 16,
    color: colors.text
  },
  addButton: { backgroundColor: colors.success, padding: 12, borderRadius: 8, alignItems: 'center' },
  addButtonText: { color: colors.text, fontWeight: 'bold' },
  surveillanceEntry: { backgroundColor: colors.surface, padding: 12, borderRadius: 8, marginBottom: 8 },
  trickText: { fontSize: 16, fontWeight: 'bold', marginBottom: 4, color: colors.text },
  videoPartText: { fontSize: 14, color: colors.textSecondary },
  
  // Camera functionality removed
});
