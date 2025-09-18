import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Image, Dimensions, TextInput } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Video, ResizeMode } from 'expo-av';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { supabase } from '../../supabase';
import { uploadImageFromUri } from '../lib/upload';

const { width } = Dimensions.get('window');

type Clip = {
  id: string;
  user_id: string;
  storage_path: string;
  thumb_path?: string;
  vote_count: number;
  created_at: string;
};

export default function SpotScreen({ route, navigation }: any) {
  const { spot } = route.params;
  const [clips, setClips] = useState<Clip[]>([]);
  const [recording, setRecording] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraRef, setCameraRef] = useState<CameraView | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [loading, setLoading] = useState(false);
  
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
      .select('*')
      .eq('spot_id', spot.id)
      .order('vote_count', { ascending: false });
    setClips(data || []);
  }

  async function loadSurveillance() {
    // For now, we'll use localStorage-style storage. In production, add a surveillance table
    // const { data } = await supabase.from('surveillance').select('*').eq('spot_id', spot.id);
    // setSurveillance(data || []);
    setSurveillance([]); // Placeholder
  }

  async function startRecording() {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) return Alert.alert('Camera permission required');
    }
    setShowCamera(true);
  }

  async function recordVideo() {
    if (!cameraRef) return;
    setRecording(true);
    try {
      const video = await cameraRef.recordAsync({ maxDuration: 10 });
      if (video?.uri) {
        await uploadClip(video.uri);
      }
    } catch (e: any) {
      Alert.alert('Recording failed', e.message);
    } finally {
      setRecording(false);
      setShowCamera(false);
    }
  }

  async function stopRecording() {
    if (cameraRef && recording) {
      cameraRef.stopRecording();
    }
  }

  async function uploadClip(videoUri: string) {
    setLoading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user) throw new Error('Not authenticated');

      const videoFileName = `${Date.now()}.mp4`;
      const videoPath = `clips/${spot.id}/${videoFileName}`;
      
      // Create thumbnail
      const thumb = await VideoThumbnails.getThumbnailAsync(videoUri, { time: 0 });
      const thumbFileName = `${Date.now()}_thumb.jpg`;
      const thumbPath = `clips/thumbs/${thumbFileName}`;

      // Upload video and thumbnail
      await uploadVideoFromUri('clips', videoPath, videoUri);
      await uploadImageFromUri('clips', thumbPath, thumb.uri);

      // Insert clip record
      const { data, error } = await supabase.from('clips').insert([{
        spot_id: spot.id,
        user_id: userData.user.id,
        storage_path: videoPath,
        thumb_path: thumbPath,
        duration_seconds: 10
      }]).select('*');

      if (error) throw error;
      setClips(prev => [data![0], ...prev]);
      Alert.alert('Success', 'Clip uploaded!');
    } catch (e: any) {
      console.error('uploadClip error', e);
      Alert.alert('Upload failed', e.message);
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

  async function addSurveillance() {
    if (!trickName || !videoPart) return Alert.alert('Missing info', 'Please enter both trick and video part');
    
    const newEntry = {
      id: Date.now().toString(),
      trick: trickName,
      videoPart: videoPart,
      spotId: spot.id
    };
    
    setSurveillance(prev => [newEntry, ...prev]);
    setTrickName('');
    setVideoPart('');
    Alert.alert('Added', 'Surveillance entry added!');
  }

  function getSpotImageUrl() {
    if (!spot.photo_path) return null;
    return supabase.storage.from('spots-photos').getPublicUrl(spot.photo_path).data.publicUrl;
  }

  if (showCamera) {
    return (
      <View style={styles.cameraContainer}>
        <CameraView
          style={styles.camera}
          facing="back"
          mode="video"
          ref={setCameraRef}
        />
        <View style={styles.cameraControls}>
          <TouchableOpacity
            style={[styles.recordButton, recording && styles.recordingButton]}
            onPress={recording ? stopRecording : recordVideo}
            disabled={loading}
          >
            <Text style={styles.recordText}>{recording ? 'Stop' : 'Record'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelButton} onPress={() => setShowCamera(false)}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const topClips = clips.slice(0, 3);

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
          {spot.photo_path ? (
            <Image source={{ uri: getSpotImageUrl() }} style={styles.spotPhoto} />
          ) : (
            <View style={styles.noPhotoPlaceholder}>
              <Text style={styles.noPhotoText}>No photo available</Text>
            </View>
          )}
        </View>

        {/* Top 3 Clips */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🏆 Top 3 Clips</Text>
          {topClips.length === 0 ? (
            <Text style={styles.noClips}>No clips yet. Be the first to battle!</Text>
          ) : (
            topClips.map((clip, index) => (
              <View key={clip.id} style={styles.clipCard}>
                <Text style={styles.clipRank}>#{index + 1}</Text>
                {clip.thumb_path && (
                  <Image 
                    source={{ uri: `${supabase.storage.from('clips').getPublicUrl(clip.thumb_path).data.publicUrl}` }}
                    style={styles.thumbnail}
                  />
                )}
                <View style={styles.clipInfo}>
                  <Text style={styles.voteCount}>❤️ {clip.vote_count}</Text>
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
          <Text style={styles.sectionSubtitle}>Record a trick to battle for this spot</Text>
          <TouchableOpacity style={styles.uploadButton} onPress={startRecording}>
            <Text style={styles.uploadButtonText}>Start Recording (10s max)</Text>
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
              value={trickName}
              onChangeText={setTrickName}
            />
            <TextInput
              style={styles.input}
              placeholder="Video part (e.g., Baker 3, Koston in Menikmati)"
              value={videoPart}
              onChangeText={setVideoPart}
            />
            <TouchableOpacity style={styles.addButton} onPress={addSurveillance}>
              <Text style={styles.addButtonText}>Add Citation</Text>
            </TouchableOpacity>
          </View>

          {surveillance.map((entry) => (
            <View key={entry.id} style={styles.surveillanceEntry}>
              <Text style={styles.trickText}>{entry.trick}</Text>
              <Text style={styles.videoPartText}>{entry.videoPart}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingTop: 48, borderBottomWidth: 1, borderBottomColor: '#eee' },
  backButton: { marginRight: 16 },
  backText: { fontSize: 16, color: '#007AFF' },
  title: { flex: 1, fontSize: 20, fontWeight: 'bold' },
  scrollContainer: { flex: 1 },
  
  // Spot photo section
  spotPhotoSection: { padding: 16 },
  spotPhoto: { width: '100%', height: 200, borderRadius: 12 },
  noPhotoPlaceholder: { width: '100%', height: 200, backgroundColor: '#f0f0f0', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  noPhotoText: { color: '#666', fontSize: 16 },
  
  // Section styles
  section: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  sectionSubtitle: { fontSize: 14, color: '#666', marginBottom: 16 },
  
  // Clips
  noClips: { textAlign: 'center', color: '#666', fontSize: 16, fontStyle: 'italic' },
  clipCard: { flexDirection: 'row', marginBottom: 12, backgroundColor: '#f9f9f9', borderRadius: 8, padding: 12, alignItems: 'center' },
  clipRank: { fontSize: 18, fontWeight: 'bold', color: '#FF6B35', marginRight: 12, minWidth: 30 },
  thumbnail: { width: 80, height: 60, borderRadius: 4 },
  clipInfo: { flex: 1, marginLeft: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  voteCount: { fontSize: 16, fontWeight: 'bold' },
  voteButton: { backgroundColor: '#007AFF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 4 },
  voteText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },
  
  // Upload section
  uploadButton: { backgroundColor: '#FF3B30', padding: 16, borderRadius: 8, alignItems: 'center' },
  uploadButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  
  // Surveillance section
  surveillanceForm: { marginBottom: 16 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, marginBottom: 8, fontSize: 16 },
  addButton: { backgroundColor: '#34C759', padding: 12, borderRadius: 8, alignItems: 'center' },
  addButtonText: { color: '#fff', fontWeight: 'bold' },
  surveillanceEntry: { backgroundColor: '#f8f8f8', padding: 12, borderRadius: 8, marginBottom: 8 },
  trickText: { fontSize: 16, fontWeight: 'bold', marginBottom: 4 },
  videoPartText: { fontSize: 14, color: '#666' },
  
  // Camera
  cameraContainer: { flex: 1 },
  camera: { flex: 1 },
  cameraControls: { position: 'absolute', bottom: 50, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 20 },
  recordButton: { backgroundColor: '#FF3B30', paddingHorizontal: 20, paddingVertical: 16, borderRadius: 30 },
  recordText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  recordingButton: { backgroundColor: '#34C759' },
  cancelButton: { backgroundColor: '#666', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 25 },
  cancelText: { color: '#fff', fontWeight: 'bold' }
});
