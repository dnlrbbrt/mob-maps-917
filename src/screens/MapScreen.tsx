import { useEffect, useState } from 'react';
import { View, Modal, Image, TextInput, Button, StyleSheet, Text, Alert, TouchableOpacity, ScrollView, Dimensions } from 'react-native';
import MapView, { MapPressEvent, Marker, Callout, Region } from 'react-native-maps';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { supabase } from '../../supabase';
import { uploadImageFromUri } from '../lib/upload';
import { colors } from '../constants/colors';

type Coord = { latitude: number; longitude: number };

export default function MapScreen({ navigation }: any) {
  const [spots, setSpots] = useState<any[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [coord, setCoord] = useState<Coord | null>(null);
  const [title, setTitle] = useState('');
  const [photoUris, setPhotoUris] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [mapRegion, setMapRegion] = useState<Region | null>(null);
  const [shouldLoadSpots, setShouldLoadSpots] = useState(false);

  useEffect(() => {
    getCurrentLocation();
  }, []);

  useEffect(() => {
    if (shouldLoadSpots && mapRegion) {
      loadSpotsInRegion();
    }
  }, [shouldLoadSpots, mapRegion]);

  async function getCurrentLocation() {
    try {
      // Request location permission
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.log('Location permission denied');
        // Fallback to default location (San Francisco)
        setMapRegion({
          latitude: 37.7749,
          longitude: -122.4194,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05
        });
        return;
      }

      // Get current location
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced
      });

      const region = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.05, // City-level zoom
        longitudeDelta: 0.05
      };

      setMapRegion(region);
      
      // Check if we should load spots at this zoom level
      checkZoomLevel(region);
    } catch (error) {
      console.error('Error getting location:', error);
      // Fallback to default location
      setMapRegion({
        latitude: 37.7749,
        longitude: -122.4194,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05
      });
    }
  }

  function checkZoomLevel(region: Region) {
    // Load spots when zoomed to multi-city level or closer
    // latitudeDelta < 0.5 allows seeing spots across multiple cities/metro areas
    const isMultiCityLevel = region.latitudeDelta < 0.5 && region.longitudeDelta < 0.5;
    setShouldLoadSpots(isMultiCityLevel);
  }

  async function loadSpotsInRegion() {
    if (!mapRegion) return;
    
    try {
      // Calculate bounding box for current region
      const northLat = mapRegion.latitude + mapRegion.latitudeDelta / 2;
      const southLat = mapRegion.latitude - mapRegion.latitudeDelta / 2;
      const eastLng = mapRegion.longitude + mapRegion.longitudeDelta / 2;
      const westLng = mapRegion.longitude - mapRegion.longitudeDelta / 2;

      // Query spots within the visible region with clip count
      const { data } = await supabase
        .from('spots')
        .select(`
          *,
          clips:clips(count)
        `)
        .gte('lat', southLat)
        .lte('lat', northLat)
        .gte('lng', westLng)
        .lte('lng', eastLng)
        .order('created_at', { ascending: false });

      console.log(`Loaded ${data?.length || 0} spots in region`);
      setSpots(data || []);
    } catch (error) {
      console.error('Error loading spots:', error);
    }
  }

  function onRegionChangeComplete(region: Region) {
    setMapRegion(region);
    checkZoomLevel(region);
  }

  function onLongPress(e: MapPressEvent) {
    const c = e.nativeEvent.coordinate;
    setCoord({ latitude: c.latitude, longitude: c.longitude });
    setTitle('');
    setPhotoUris([]);
    setModalVisible(true);
  }

  async function pickImage() {
    const res = await ImagePicker.launchImageLibraryAsync({ 
      mediaTypes: ImagePicker.MediaTypeOptions.Images, 
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: 5 // Limit to 5 photos
    });
    if (!res.canceled && res.assets) {
      const newUris = res.assets.map(asset => asset.uri);
      setPhotoUris(prev => [...prev, ...newUris].slice(0, 5)); // Max 5 photos
    }
  }

  function removePhoto(index: number) {
    setPhotoUris(prev => prev.filter((_, i) => i !== index));
  }

  // Upload via FormData to avoid blob issues on some RN runtimes
  async function uploadToStorage(uri: string, bucket: string, path: string) {
    return uploadImageFromUri(bucket, path, uri);
  }

  async function createSpot() {
    if (!coord || photoUris.length === 0) return Alert.alert('Missing data', 'Please add at least one photo');
    setLoading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user) {
        Alert.alert('Not signed in', 'Please sign in before creating a spot.');
        setLoading(false);
        return;
      }

      // Upload all photos first
      const uploadedPaths: string[] = [];
      for (let i = 0; i < photoUris.length; i++) {
        const fileName = `${Date.now()}_${i}.jpg`;
        const storagePath = `spots/${fileName}`;
        console.log('Uploading photo', i + 1, 'to path:', storagePath);
        await uploadToStorage(photoUris[i], 'spots-photos', storagePath);
        uploadedPaths.push(storagePath);
      }

      // Create the spot (keep first photo in photo_path for backward compatibility)
      console.log('Creating spot with', uploadedPaths.length, 'photos');
      const { data: spotData, error: spotError } = await supabase.from('spots').insert([
        { title, lat: coord.latitude, lng: coord.longitude, photo_path: uploadedPaths[0] }
      ]).select('*');
      
      if (spotError) throw spotError;
      const newSpot = spotData![0];

      // Insert all photos into spot_photos table
      const spotPhotos = uploadedPaths.map((path, index) => ({
        spot_id: newSpot.id,
        photo_path: path,
        display_order: index
      }));

      const { error: photosError } = await supabase.from('spot_photos').insert(spotPhotos);
      if (photosError) {
        console.warn('Failed to insert spot photos:', photosError);
        // Don't throw error - spot was created successfully
      }

      setSpots((prev) => [newSpot, ...prev]);
      setModalVisible(false);
      setTitle('');
      setPhotoUris([]);
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

  function getMarkerColor(spot: any) {
    // Check if spot has clips - red if has clips, green if no clips
    const hasClips = spot.clips && spot.clips.length > 0 && spot.clips[0].count > 0;
    return hasClips ? '#FF0000' : '#00FF00'; // Red if has clips, green if no clips
  }

  return (
    <View style={{ flex: 1 }}>
      <MapView 
        style={{ flex: 1 }} 
        onLongPress={onLongPress}
        region={mapRegion || undefined}
        onRegionChangeComplete={onRegionChangeComplete}
        showsUserLocation={true}
        showsMyLocationButton={false}
      >
        {shouldLoadSpots && spots.map((s) => (
          <Marker 
            key={s.id} 
            coordinate={{ latitude: s.lat, longitude: s.lng }}
            pinColor={getMarkerColor(s)}
          >
            <Callout onPress={() => navigation.navigate('Spot', { spot: s })}>
              <View style={styles.callout}>
                {s.photo_path && (
                  <Image source={{ uri: getSpotImageUrl(s) }} style={styles.calloutImage} />
                )}
                <Text style={styles.calloutTitle}>{s.title || 'Spot'}</Text>
                <Text style={styles.calloutSubtitle}>Tap to claim territory!</Text>
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>
      
      {/* Zoom level indicator */}
      {!shouldLoadSpots && (
        <View style={styles.zoomIndicator}>
          <Text style={styles.zoomText}>🔍 Zoom in to see spots</Text>
        </View>
      )}
      <Modal visible={modalVisible} animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modal}>
          <Text style={styles.header}>Create spot</Text>
          <TextInput placeholder="Title" value={title} onChangeText={setTitle} style={styles.input} />
          
          {/* Photo Preview Section */}
          {photoUris.length > 0 && (
            <ScrollView horizontal style={styles.photoScrollView} showsHorizontalScrollIndicator={false}>
              {photoUris.map((uri, index) => (
                <View key={index} style={styles.photoContainer}>
                  <Image source={{ uri }} style={styles.preview} />
                  <TouchableOpacity style={styles.removeButton} onPress={() => removePhoto(index)}>
                    <Text style={styles.removeButtonText}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}
          
          <Text style={styles.photoCount}>{photoUris.length}/5 photos</Text>
          
          <View style={styles.row}>
            <Button 
              title={photoUris.length === 0 ? "Pick Photos" : "Add More"} 
              onPress={pickImage} 
              disabled={photoUris.length >= 5}
            />
            <View style={{ width: 12 }} />
            <Button 
              title={loading ? '...' : 'Create'} 
              onPress={createSpot} 
              disabled={loading || photoUris.length === 0} 
            />
          </View>
          <View style={{ height: 8 }} />
          <Button title="Cancel" color="#666" onPress={() => setModalVisible(false)} />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  modal: { 
    flex: 1, 
    padding: 16, 
    paddingTop: 48,
    backgroundColor: colors.background
  },
  header: { 
    fontSize: 22, 
    marginBottom: 12,
    color: colors.text,
    fontWeight: 'bold'
  },
  input: { 
    borderWidth: 1, 
    borderColor: colors.inputBorder, 
    backgroundColor: colors.input,
    borderRadius: 8, 
    padding: 12, 
    marginBottom: 12,
    color: colors.text,
    fontSize: 16
  },
  photoScrollView: {
    height: 120,
    marginBottom: 8
  },
  photoContainer: {
    position: 'relative',
    marginRight: 8
  },
  preview: { 
    width: 100, 
    height: 100, 
    borderRadius: 8
  },
  removeButton: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: '#FF0000',
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center'
  },
  removeButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold'
  },
  photoCount: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: 14,
    marginBottom: 12
  },
  row: { 
    flexDirection: 'row', 
    alignItems: 'center',
    gap: 12
  },
  callout: { 
    width: 200, 
    padding: 8,
    backgroundColor: colors.surface,
    borderRadius: 8
  },
  calloutImage: { 
    width: '100%', 
    height: 100, 
    borderRadius: 4, 
    marginBottom: 4 
  },
  calloutTitle: { 
    fontSize: 16, 
    fontWeight: 'bold',
    color: colors.text
  },
  calloutSubtitle: { 
    fontSize: 12, 
    color: colors.primary
  },
  zoomIndicator: {
    position: 'absolute',
    top: 60,
    left: 16,
    right: 16,
    backgroundColor: colors.mapBackground,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center'
  },
  zoomText: { 
    color: colors.mapText, 
    fontSize: 16, 
    fontWeight: 'bold' 
  }
});


