import { useEffect, useState } from 'react';
import { View, Modal, Image, TextInput, Button, StyleSheet, Text, Alert } from 'react-native';
import MapView, { MapPressEvent, Marker, Callout } from 'react-native-maps';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../supabase';
import { uploadImageFromUri } from '../lib/upload';

type Coord = { latitude: number; longitude: number };

export default function MapScreen({ navigation }: any) {
  const [spots, setSpots] = useState<any[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [coord, setCoord] = useState<Coord | null>(null);
  const [title, setTitle] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('spots').select('*').order('created_at', { ascending: false });
      setSpots(data || []);
    })();
  }, []);

  function onLongPress(e: MapPressEvent) {
    const c = e.nativeEvent.coordinate;
    setCoord({ latitude: c.latitude, longitude: c.longitude });
    setTitle('');
    setPhotoUri(null);
    setModalVisible(true);
  }

  async function pickImage() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (!res.canceled) setPhotoUri(res.assets[0].uri);
  }

  // Upload via FormData to avoid blob issues on some RN runtimes
  async function uploadToStorage(uri: string, bucket: string, path: string) {
    return uploadImageFromUri(bucket, path, uri);
  }

  async function createSpot() {
    if (!coord || !photoUri) return Alert.alert('Missing data', 'Please add a photo');
    setLoading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user) {
        Alert.alert('Not signed in', 'Please sign in before creating a spot.');
        setLoading(false);
        return;
      }
      const fileName = `${Date.now()}.jpg`;
      const storagePath = `spots/${fileName}`;
      console.log('Uploading to path:', storagePath);
      await uploadToStorage(photoUri, 'spots-photos', storagePath);
      console.log('Upload successful, inserting spot with photo_path:', storagePath);
      const { data, error } = await supabase.from('spots').insert([
        { title, lat: coord.latitude, lng: coord.longitude, photo_path: storagePath }
      ]).select('*');
      if (error) throw error;
      setSpots((prev) => [data![0], ...prev]);
      setModalVisible(false);
    } catch (e: any) {
      console.error('createSpot error', e);
      const msg = e?.message || e?.error_description || 'Failed to create spot';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  }

  function getSpotImageUrl(spot: any) {
    if (!spot.photo_path) {
      console.log('No photo_path for spot:', spot.id);
      return null;
    }
    const url = supabase.storage.from('spots-photos').getPublicUrl(spot.photo_path).data.publicUrl;
    console.log('Spot image URL:', url, 'for path:', spot.photo_path);
    return url;
  }

  return (
    <View style={{ flex: 1 }}>
      <MapView style={{ flex: 1 }} onLongPress={onLongPress}>
        {spots.map((s) => (
          <Marker key={s.id} coordinate={{ latitude: s.lat, longitude: s.lng }}>
            <Callout onPress={() => navigation.navigate('Spot', { spot: s })}>
              <View style={styles.callout}>
                {s.photo_path && (
                  <Image source={{ uri: getSpotImageUrl(s) }} style={styles.calloutImage} />
                )}
                <Text style={styles.calloutTitle}>{s.title || 'Spot'}</Text>
                <Text style={styles.calloutSubtitle}>Tap to battle!</Text>
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>
      <Modal visible={modalVisible} animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modal}>
          <Text style={styles.header}>Create spot</Text>
          <TextInput placeholder="Title" value={title} onChangeText={setTitle} style={styles.input} />
          {photoUri ? <Image source={{ uri: photoUri }} style={styles.preview} /> : null}
          <View style={styles.row}>
            <Button title="Pick Photo" onPress={pickImage} />
            <View style={{ width: 12 }} />
            <Button title={loading ? '...' : 'Create'} onPress={createSpot} disabled={loading || !photoUri} />
          </View>
          <View style={{ height: 8 }} />
          <Button title="Cancel" color="#666" onPress={() => setModalVisible(false)} />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1, padding: 16, paddingTop: 48 },
  header: { fontSize: 22, marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, marginBottom: 12 },
  preview: { width: '100%', height: 240, borderRadius: 8, marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center' },
  callout: { width: 200, padding: 8 },
  calloutImage: { width: '100%', height: 100, borderRadius: 4, marginBottom: 4 },
  calloutTitle: { fontSize: 16, fontWeight: 'bold' },
  calloutSubtitle: { fontSize: 12, color: '#666' }
});


