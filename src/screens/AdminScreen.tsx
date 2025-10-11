import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Image, Dimensions } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { supabase } from '../../supabase';
import { colors } from '../constants/colors';

const { width } = Dimensions.get('window');

type FlaggedContent = {
  content_type: 'clip' | 'spot' | 'surveillance';
  content_id: string;
  flag_count: number;
  created_at: string;
  content_data: any;
  reasons?: { reason: string; count: number }[];
};

export default function AdminScreen({ navigation }: any) {
  const [flaggedContent, setFlaggedContent] = useState<FlaggedContent[]>([]);
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    checkAdminStatus();
  }, []);

  useEffect(() => {
    if (isAdmin) {
      loadFlaggedContent();
    }
  }, [isAdmin]);

  async function checkAdminStatus() {
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user) {
        navigation.goBack();
        return;
      }

      // Check if user is admin (dnlrbbrt@gmail.com)
      if (userData.user.email === 'dnlrbbrt@gmail.com') {
        setIsAdmin(true);
      } else {
        Alert.alert('Access Denied', 'You do not have admin privileges.');
        navigation.goBack();
      }
    } catch (error) {
      console.error('Admin check error:', error);
      navigation.goBack();
    }
  }

  async function loadFlaggedContent() {
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('get_flagged_content');
      if (error) throw error;
      
      // Fetch reasons for each flagged content
      if (data && data.length > 0) {
        const contentWithReasons = await Promise.all(
          data.map(async (item: FlaggedContent) => {
            // Get all flags for this content and group by reason
            const { data: flags } = await supabase
              .from('flags')
              .select('reason')
              .eq('content_type', item.content_type)
              .eq('content_id', item.content_id);
            
            // Count occurrences of each reason
            const reasonCounts: { [key: string]: number } = {};
            flags?.forEach(flag => {
              reasonCounts[flag.reason] = (reasonCounts[flag.reason] || 0) + 1;
            });
            
            // Convert to array format
            const reasons = Object.entries(reasonCounts).map(([reason, count]) => ({
              reason,
              count
            }));
            
            return { ...item, reasons };
          })
        );
        
        setFlaggedContent(contentWithReasons);
      } else {
        setFlaggedContent(data || []);
      }
    } catch (error) {
      console.error('Error loading flagged content:', error);
      Alert.alert('Error', 'Failed to load flagged content');
    } finally {
      setLoading(false);
    }
  }

  async function moderateContent(contentType: string, contentId: string, action: 'approve' | 'delete') {
    try {
      if (action === 'approve') {
        // Delete all flags for this content (approve it)
        const { error: flagError } = await supabase
          .from('flags')
          .delete()
          .eq('content_type', contentType)
          .eq('content_id', contentId);

        if (flagError) throw flagError;

        Alert.alert('Approved', 'Content has been approved and flags removed.');
      } else if (action === 'delete') {
        // Delete content permanently
        const table = contentType === 'clip' ? 'clips' : contentType === 'spot' ? 'spots' : 'surveillance';
        const { error } = await supabase
          .from(table)
          .delete()
          .eq('id', contentId);

        if (error) throw error;

        Alert.alert('Deleted', 'Content has been permanently deleted.');
      }

      // Reload flagged content
      loadFlaggedContent();
    } catch (error: any) {
      console.error('Moderation error:', error);
      Alert.alert('Error', 'Failed to moderate content: ' + error.message);
    }
  }

  function formatReason(reason: string): string {
    // Format the reason string to be more readable
    const reasonMap: { [key: string]: string } = {
      'inappropriate': 'Inappropriate Content',
      'offensive': 'Offensive',
      'spam': 'Spam',
      'not_a_spot': 'Not a Real Spot',
      'poor_quality': 'Poor Quality'
    };
    return reasonMap[reason] || reason.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  function getContentPreview(item: FlaggedContent) {
    if (item.content_type === 'clip') {
      return (
        <View style={styles.contentPreview}>
          {item.content_data.thumb_path && (
            <Image
              source={{ uri: `${supabase.storage.from('clips').getPublicUrl(item.content_data.thumb_path).data.publicUrl}` }}
              style={styles.thumbnail}
            />
          )}
          <View style={styles.contentInfo}>
            <Text style={styles.contentTitle}>Video Clip</Text>
            <Text style={styles.contentDetails}>Votes: {item.content_data.vote_count}</Text>
            <Text style={styles.contentDetails}>By: @{item.content_data.profiles?.username || 'anonymous'}</Text>
          </View>
        </View>
      );
    } else if (item.content_type === 'spot') {
      return (
        <View style={styles.contentPreview}>
          {item.content_data.photo_path && (
            <Image
              source={{ uri: `${supabase.storage.from('spots-photos').getPublicUrl(item.content_data.photo_path).data.publicUrl}` }}
              style={styles.thumbnail}
            />
          )}
          <View style={styles.contentInfo}>
            <Text style={styles.contentTitle}>Spot: {item.content_data.title}</Text>
            <Text style={styles.contentDetails}>Location: {item.content_data.lat}, {item.content_data.lng}</Text>
          </View>
        </View>
      );
    } else if (item.content_type === 'surveillance') {
      return (
        <View style={styles.contentPreview}>
          <View style={styles.contentInfo}>
            <Text style={styles.contentTitle}>Surveillance Citation</Text>
            <Text style={styles.contentDetails}>Trick: {item.content_data.trick_name}</Text>
            <Text style={styles.contentDetails}>Video Part: {item.content_data.video_part}</Text>
          </View>
        </View>
      );
    }
  }

  if (!isAdmin) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Checking admin access...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={navigation.goBack} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Admin Dashboard</Text>
        <TouchableOpacity onPress={loadFlaggedContent} style={styles.refreshButton}>
          <Text style={styles.refreshText}>🔄</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollContainer}>
        {loading ? (
          <Text style={styles.loadingText}>Loading flagged content...</Text>
        ) : flaggedContent.length === 0 ? (
          <Text style={styles.noContentText}>No flagged content to review! 🎉</Text>
        ) : (
          flaggedContent.map((item) => (
            <View key={`${item.content_type}-${item.content_id}`} style={styles.flaggedItem}>
              <View style={styles.flaggedHeader}>
                <Text style={styles.flagCount}>🚩 {item.flag_count} reports</Text>
                <Text style={styles.contentType}>{item.content_type.toUpperCase()}</Text>
              </View>

              {/* Display report reasons */}
              {item.reasons && item.reasons.length > 0 && (
                <View style={styles.reasonsContainer}>
                  <Text style={styles.reasonsTitle}>Reported for:</Text>
                  {item.reasons.map((reasonItem, index) => (
                    <View key={index} style={styles.reasonItem}>
                      <Text style={styles.reasonText}>
                        • {formatReason(reasonItem.reason)}
                      </Text>
                      {reasonItem.count > 1 && (
                        <Text style={styles.reasonCount}>({reasonItem.count})</Text>
                      )}
                    </View>
                  ))}
                </View>
              )}

              {getContentPreview(item)}

              <View style={styles.actionButtons}>
                <TouchableOpacity
                  style={styles.approveButton}
                  onPress={() => moderateContent(item.content_type, item.content_id, 'approve')}
                >
                  <Text style={styles.approveText}>✅ Approve</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => {
                    Alert.alert(
                      'Delete Content',
                      'Are you sure you want to permanently delete this content? This action cannot be undone.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { 
                          text: 'Delete', 
                          style: 'destructive',
                          onPress: () => moderateContent(item.content_type, item.content_id, 'delete')
                        }
                      ]
                    );
                  }}
                >
                  <Text style={styles.deleteText}>🗑️ Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: 16, 
    paddingTop: 48, 
    borderBottomWidth: 1, 
    borderBottomColor: colors.border 
  },
  backButton: { paddingRight: 16 },
  backText: { fontSize: 16, color: colors.primary },
  title: { flex: 1, fontSize: 20, fontWeight: 'bold', color: colors.text },
  refreshButton: { paddingLeft: 16 },
  refreshText: { fontSize: 18 },
  scrollContainer: { flex: 1, padding: 16 },
  loadingText: { textAlign: 'center', color: colors.textSecondary, fontSize: 16, marginTop: 50 },
  noContentText: { textAlign: 'center', color: colors.textSecondary, fontSize: 16, marginTop: 50 },
  
  flaggedItem: { 
    backgroundColor: colors.surface, 
    borderRadius: 8, 
    padding: 16, 
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: colors.error
  },
  flaggedHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 12 
  },
  flagCount: { fontSize: 16, fontWeight: 'bold', color: colors.error },
  contentType: { fontSize: 12, color: colors.textSecondary, fontWeight: 'bold' },
  
  reasonsContainer: {
    backgroundColor: 'rgba(255, 100, 100, 0.1)',
    padding: 12,
    borderRadius: 6,
    marginBottom: 12
  },
  reasonsTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 6
  },
  reasonItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4
  },
  reasonText: {
    fontSize: 14,
    color: colors.text,
    marginRight: 8
  },
  reasonCount: {
    fontSize: 12,
    color: colors.textSecondary,
    fontStyle: 'italic'
  },
  
  contentPreview: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  thumbnail: { width: 60, height: 60, borderRadius: 8, marginRight: 12 },
  contentInfo: { flex: 1 },
  contentTitle: { fontSize: 16, fontWeight: 'bold', color: colors.text, marginBottom: 4 },
  contentDetails: { fontSize: 14, color: colors.textSecondary, marginBottom: 2 },
  
  actionButtons: { flexDirection: 'row', gap: 12 },
  approveButton: { 
    flex: 1, 
    backgroundColor: colors.success, 
    paddingVertical: 12, 
    borderRadius: 8, 
    alignItems: 'center' 
  },
  approveText: { color: colors.text, fontWeight: 'bold' },
  deleteButton: { 
    flex: 1, 
    backgroundColor: colors.error, 
    paddingVertical: 12, 
    borderRadius: 8, 
    alignItems: 'center' 
  },
  deleteText: { color: 'white', fontWeight: 'bold' }
});