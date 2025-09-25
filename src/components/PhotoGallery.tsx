import React, { useState } from 'react';
import { View, Image, StyleSheet, Dimensions, Text, ScrollView, TouchableOpacity } from 'react-native';
import { colors } from '../constants/colors';

const { width: screenWidth } = Dimensions.get('window');

type PhotoGalleryProps = {
  photos: { photo_path: string }[];
  getImageUrl: (path: string) => string | null;
  onPhotoPress?: (index: number) => void;
};

export default function PhotoGallery({ photos, getImageUrl, onPhotoPress }: PhotoGalleryProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  if (!photos || photos.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No photos available</Text>
      </View>
    );
  }

  // Single photo - display full width
  if (photos.length === 1) {
    const imageUrl = getImageUrl(photos[0].photo_path);
    return (
      <View style={styles.singlePhotoContainer}>
        {imageUrl ? (
          <TouchableOpacity 
            onPress={() => onPhotoPress?.(0)}
            style={styles.singlePhotoTouchable}
          >
            <Image source={{ uri: imageUrl }} style={styles.singlePhoto} />
          </TouchableOpacity>
        ) : (
          <View style={styles.placeholderContainer}>
            <Text style={styles.placeholderText}>📷</Text>
          </View>
        )}
      </View>
    );
  }

  // Multiple photos - swipeable gallery
  const onScroll = (event: any) => {
    const contentOffsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(contentOffsetX / screenWidth);
    setCurrentIndex(index);
  };

  return (
    <View style={styles.galleryContainer}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={styles.scrollView}
      >
        {photos.map((photo, index) => {
          const imageUrl = getImageUrl(photo.photo_path);
          return (
            <TouchableOpacity
              key={index}
              style={styles.photoSlide}
              onPress={() => onPhotoPress?.(index)}
            >
              {imageUrl ? (
                <Image source={{ uri: imageUrl }} style={styles.galleryPhoto} />
              ) : (
                <View style={styles.placeholderContainer}>
                  <Text style={styles.placeholderText}>📷</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      
      {/* Photo indicator dots */}
      <View style={styles.indicatorContainer}>
        {photos.map((_, index) => (
          <View
            key={index}
            style={[
              styles.indicator,
              { backgroundColor: index === currentIndex ? colors.primary : colors.textTertiary }
            ]}
          />
        ))}
      </View>
      
      {/* Photo counter */}
      <View style={styles.counterContainer}>
        <Text style={styles.counterText}>
          {currentIndex + 1} / {photos.length}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyContainer: {
    height: 200,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 16
  },
  singlePhotoContainer: {
    borderRadius: 12,
    overflow: 'hidden'
  },
  singlePhotoTouchable: {
    width: '100%'
  },
  singlePhoto: {
    width: '100%',
    height: 200,
    resizeMode: 'cover'
  },
  galleryContainer: {
    position: 'relative',
    borderRadius: 12,
    overflow: 'hidden'
  },
  scrollView: {
    width: '100%'
  },
  photoSlide: {
    width: screenWidth - 32, // Account for margins
    height: 200
  },
  galleryPhoto: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover'
  },
  placeholderContainer: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center'
  },
  placeholderText: {
    fontSize: 32,
    color: colors.textSecondary
  },
  indicatorContainer: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6
  },
  indicator: {
    width: 8,
    height: 8,
    borderRadius: 4
  },
  counterContainer: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12
  },
  counterText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold'
  }
});
