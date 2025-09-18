import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity } from 'react-native';
import { supabase } from '../../supabase';

type LeaderboardUser = {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  spots_owned: number;
};

export default function LeaderboardScreen() {
  const [users, setUsers] = useState<LeaderboardUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLeaderboard();
  }, []);

  async function loadLeaderboard() {
    try {
      setLoading(true);
      
      // Get users with their spot counts
      const { data, error } = await supabase.rpc('get_leaderboard', { limit_count: 20 });
      
      if (error) {
        console.error('Leaderboard error:', error);
        // Fallback to manual query if RPC doesn't exist
        await loadLeaderboardManual();
        return;
      }
      
      setUsers(data || []);
    } catch (e: any) {
      console.error('loadLeaderboard error:', e);
      await loadLeaderboardManual();
    } finally {
      setLoading(false);
    }
  }

  async function loadLeaderboardManual() {
    try {
      // Manual query to get user spot counts
      const { data, error } = await supabase
        .from('profiles')
        .select(`
          id,
          username,
          display_name,
          avatar_url,
          spots!owner_user_id(count)
        `);

      if (error) throw error;

      // Transform and sort the data
      const leaderboard = data
        .map(user => ({
          ...user,
          spots_owned: user.spots?.[0]?.count || 0
        }))
        .filter(user => user.spots_owned > 0)
        .sort((a, b) => b.spots_owned - a.spots_owned)
        .slice(0, 20);

      setUsers(leaderboard);
    } catch (e: any) {
      console.error('loadLeaderboardManual error:', e);
    }
  }

  function getAvatarUrl(avatarPath?: string) {
    if (!avatarPath) return null;
    return supabase.storage.from('spots-photos').getPublicUrl(avatarPath).data.publicUrl;
  }

  function getRankEmoji(index: number) {
    switch (index) {
      case 0: return '🥇';
      case 1: return '🥈';
      case 2: return '🥉';
      default: return `#${index + 1}`;
    }
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>🏆 Leaderboard</Text>
        </View>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading leaderboard...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>🏆 Leaderboard</Text>
        <Text style={styles.subtitle}>Top spot owners</Text>
      </View>
      
      <ScrollView style={styles.scrollContainer}>
        {users.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No spot owners yet!</Text>
            <Text style={styles.emptySubtext}>Be the first to claim a spot</Text>
          </View>
        ) : (
          users.map((user, index) => (
            <View key={user.id} style={[
              styles.userCard,
              index < 3 && styles.topThreeCard
            ]}>
              <View style={styles.rankContainer}>
                <Text style={[
                  styles.rank,
                  index < 3 && styles.topThreeRank
                ]}>
                  {getRankEmoji(index)}
                </Text>
              </View>
              
              <View style={styles.avatarContainer}>
                {user.avatar_url ? (
                  <Image 
                    source={{ uri: getAvatarUrl(user.avatar_url) }} 
                    style={styles.avatar}
                  />
                ) : (
                  <View style={styles.avatarPlaceholder}>
                    <Text style={styles.avatarText}>👤</Text>
                  </View>
                )}
              </View>
              
              <View style={styles.userInfo}>
                <Text style={styles.username}>@{user.username || 'anonymous'}</Text>
                <Text style={styles.displayName}>{user.display_name || 'User'}</Text>
              </View>
              
              <View style={styles.scoreContainer}>
                <Text style={styles.spotCount}>{user.spots_owned}</Text>
                <Text style={styles.spotLabel}>spots</Text>
              </View>
            </View>
          ))
        )}
        
        {users.length > 0 && (
          <View style={styles.footerContainer}>
            <Text style={styles.footerText}>
              Battle for spots to climb the leaderboard! 🚀
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { 
    padding: 20, 
    paddingTop: 60, 
    backgroundColor: '#f8f8f8', 
    borderBottomWidth: 1, 
    borderBottomColor: '#eee',
    alignItems: 'center'
  },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 4 },
  subtitle: { fontSize: 16, color: '#666' },
  
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontSize: 16, color: '#666' },
  
  scrollContainer: { flex: 1 },
  
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyText: { fontSize: 18, fontWeight: 'bold', color: '#666', marginBottom: 8 },
  emptySubtext: { fontSize: 14, color: '#999' },
  
  userCard: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: 16, 
    marginHorizontal: 16, 
    marginVertical: 4,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#eee',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2
  },
  topThreeCard: {
    backgroundColor: '#fff9e6',
    borderColor: '#ffd700',
    borderWidth: 2
  },
  
  rankContainer: { marginRight: 12, minWidth: 40 },
  rank: { fontSize: 16, fontWeight: 'bold', textAlign: 'center' },
  topThreeRank: { fontSize: 20 },
  
  avatarContainer: { marginRight: 12 },
  avatar: { width: 50, height: 50, borderRadius: 25 },
  avatarPlaceholder: { 
    width: 50, 
    height: 50, 
    borderRadius: 25, 
    backgroundColor: '#f0f0f0', 
    alignItems: 'center', 
    justifyContent: 'center' 
  },
  avatarText: { fontSize: 20 },
  
  userInfo: { flex: 1 },
  username: { fontSize: 16, fontWeight: 'bold', color: '#007AFF', marginBottom: 2 },
  displayName: { fontSize: 14, color: '#666' },
  
  scoreContainer: { alignItems: 'center' },
  spotCount: { fontSize: 20, fontWeight: 'bold', color: '#FF6B35' },
  spotLabel: { fontSize: 12, color: '#666' },
  
  footerContainer: { padding: 20, alignItems: 'center' },
  footerText: { fontSize: 14, color: '#999', textAlign: 'center', fontStyle: 'italic' }
});
