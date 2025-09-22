import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity } from 'react-native';
import { supabase } from '../../supabase';
import { colors } from '../constants/colors';

type LeaderboardUser = {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  spots_owned: number;
};

type MobLeaderboard = {
  mob_id: string;
  mob_name: string;
  total_spots_owned: number;
  member_count: number;
};

export default function LeaderboardScreen() {
  const [users, setUsers] = useState<LeaderboardUser[]>([]);
  const [mobs, setMobs] = useState<MobLeaderboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'users' | 'mobs'>('users');

  useEffect(() => {
    loadLeaderboards();
  }, []);

  async function loadLeaderboards() {
    try {
      setLoading(true);
      
      // Load user leaderboard
      const { data: userData, error: userError } = await supabase.rpc('get_leaderboard', { limit_count: 20 });
      
      if (userError) {
        console.error('User leaderboard error:', userError);
        await loadLeaderboardManual();
      } else {
        setUsers(userData || []);
      }

      // Load mob leaderboard
      const { data: mobData, error: mobError } = await supabase.rpc('get_mob_leaderboard', { limit_count: 20 });
      
      if (mobError) {
        console.error('Mob leaderboard error:', mobError);
      } else {
        setMobs(mobData || []);
      }
      
    } catch (e: any) {
      console.error('loadLeaderboards error:', e);
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
        
        {/* Tab Switcher */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'users' && styles.activeTab]}
            onPress={() => setActiveTab('users')}
          >
            <Text style={[styles.tabText, activeTab === 'users' && styles.activeTabText]}>
              👤 Associates
            </Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.tab, activeTab === 'mobs' && styles.activeTab]} 
            onPress={() => setActiveTab('mobs')}
          >
            <Text style={[styles.tabText, activeTab === 'mobs' && styles.activeTabText]}>
              👥 Mobs
            </Text>
          </TouchableOpacity>
        </View>
      </View>
      
      <ScrollView style={styles.scrollContainer}>
        {activeTab === 'users' ? (
          users.length === 0 ? (
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
          )
        ) : (
          mobs.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No mobs with spots yet!</Text>
              <Text style={styles.emptySubtext}>Create a mob and start claiming spots</Text>
            </View>
          ) : (
            mobs.map((mob, index) => (
              <View key={mob.mob_id} style={[
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
                  <View style={styles.mobIcon}>
                    <Text style={styles.mobIconText}>👥</Text>
                  </View>
                </View>
                
                <View style={styles.userInfo}>
                  <Text style={styles.username}>{mob.mob_name}</Text>
                  <Text style={styles.displayName}>{mob.member_count} members</Text>
                </View>
                
                <View style={styles.scoreContainer}>
                  <Text style={styles.spotCount}>{mob.total_spots_owned}</Text>
                  <Text style={styles.spotLabel}>spots</Text>
                </View>
              </View>
            ))
          )
        )}
        
        {((activeTab === 'users' && users.length > 0) || (activeTab === 'mobs' && mobs.length > 0)) && (
          <View style={styles.footerContainer}>
            <Text style={styles.footerText}>
              {activeTab === 'users'
                ? 'Battle for territory to climb the leaderboard! 🚀'
                : 'Join forces with your mob to dominate! 👥'
              }
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { 
    padding: 20, 
    paddingTop: 60, 
    backgroundColor: colors.surface, 
    borderBottomWidth: 1, 
    borderBottomColor: colors.border,
    alignItems: 'center'
  },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 4, color: colors.text },
  subtitle: { fontSize: 16, color: colors.textSecondary, marginBottom: 16 },
  
  tabContainer: { flexDirection: 'row', backgroundColor: colors.surfaceVariant, borderRadius: 8, padding: 4 },
  tab: { flex: 1, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 6, alignItems: 'center' },
  activeTab: { backgroundColor: colors.primary },
  tabText: { fontSize: 14, fontWeight: '500', color: colors.textSecondary },
  activeTabText: { color: colors.text },
  
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontSize: 16, color: colors.textSecondary },
  
  scrollContainer: { flex: 1 },
  
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyText: { fontSize: 18, fontWeight: 'bold', color: colors.textSecondary, marginBottom: 8 },
  emptySubtext: { fontSize: 14, color: colors.textTertiary },
  
  userCard: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: 16, 
    marginHorizontal: 16, 
    marginVertical: 4,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2
  },
  topThreeCard: {
    backgroundColor: colors.surfaceVariant,
    borderColor: colors.gold,
    borderWidth: 2
  },
  
  rankContainer: { marginRight: 12, minWidth: 40 },
  rank: { fontSize: 16, fontWeight: 'bold', textAlign: 'center', color: colors.text },
  topThreeRank: { fontSize: 20 },
  
  avatarContainer: { marginRight: 12 },
  avatar: { width: 50, height: 50, borderRadius: 25 },
  avatarPlaceholder: { 
    width: 50, 
    height: 50, 
    borderRadius: 25, 
    backgroundColor: colors.surfaceVariant, 
    alignItems: 'center', 
    justifyContent: 'center' 
  },
  avatarText: { fontSize: 20, color: colors.textSecondary },
  
  mobIcon: { 
    width: 50, 
    height: 50, 
    borderRadius: 25, 
    backgroundColor: colors.primary, 
    alignItems: 'center', 
    justifyContent: 'center' 
  },
  mobIconText: { fontSize: 20, color: colors.text },
  
  userInfo: { flex: 1 },
  username: { fontSize: 16, fontWeight: 'bold', color: colors.primary, marginBottom: 2 },
  displayName: { fontSize: 14, color: colors.textSecondary },
  
  scoreContainer: { alignItems: 'center' },
  spotCount: { fontSize: 20, fontWeight: 'bold', color: colors.primary },
  spotLabel: { fontSize: 12, color: colors.textSecondary },
  
  footerContainer: { padding: 20, alignItems: 'center' },
  footerText: { fontSize: 14, color: colors.textTertiary, textAlign: 'center', fontStyle: 'italic' }
});
