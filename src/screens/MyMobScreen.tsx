import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, TextInput, Image, RefreshControl } from 'react-native';
import { supabase } from '../../supabase';
import { colors } from '../constants/colors';

type Mob = {
  id: string;
  name: string;
  invite_code: string;
  owner_user_id: string;
  created_at: string;
};

type MobMember = {
  id: string;
  user_id: string;
  joined_at: string;
  profiles: {
    username: string;
    display_name: string;
    avatar_url?: string;
  };
};

export default function MyMobScreen({ navigation }: any) {
  const [currentMob, setCurrentMob] = useState<Mob | null>(null);
  const [mobMembers, setMobMembers] = useState<MobMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showJoinForm, setShowJoinForm] = useState(false);
  
  // Form states
  const [mobName, setMobName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [totalSpotsOwned, setTotalSpotsOwned] = useState(0);

  useEffect(() => {
    loadUserMob();
  }, []);

  async function loadUserMob() {
    try {
      setLoading(true);
      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user) return;

      // Check if user is in a mob
      const { data: memberData } = await supabase
        .from('mob_members')
        .select(`
          *,
          mobs:mob_id (
            id,
            name,
            invite_code,
            owner_user_id,
            created_at
          )
        `)
        .eq('user_id', userData.user.id)
        .single();

      if (memberData?.mobs) {
        setCurrentMob(memberData.mobs as any);
        await loadMobMembers(memberData.mobs.id);
        await loadMobSpotCount(memberData.mobs.id);
      }
    } catch (e: any) {
      console.error('loadUserMob error:', e);
    } finally {
      setLoading(false);
    }
  }

  async function loadMobMembers(mobId: string) {
    try {
      const { data } = await supabase
        .from('mob_members')
        .select(`
          *,
          profiles:user_id (
            username,
            display_name,
            avatar_url
          )
        `)
        .eq('mob_id', mobId)
        .order('joined_at', { ascending: true });

      setMobMembers(data || []);
    } catch (e: any) {
      console.error('loadMobMembers error:', e);
    }
  }

  async function loadMobSpotCount(mobId: string) {
    try {
      const { data } = await supabase.rpc('get_mob_leaderboard', { limit_count: 1000 });
      const mobData = data?.find((mob: any) => mob.mob_id === mobId);
      setTotalSpotsOwned(mobData?.total_spots_owned || 0);
    } catch (e: any) {
      console.error('loadMobSpotCount error:', e);
    }
  }

  async function createMob() {
    if (!mobName.trim()) {
      Alert.alert('Error', 'Please enter a mob name');
      return;
    }

    try {
      setLoading(true);
      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user) throw new Error('Not authenticated');

      // Generate invite code
      const { data: codeData, error: codeError } = await supabase.rpc('generate_invite_code');
      if (codeError) throw codeError;

      const inviteCode = codeData;

      // Create mob
      const { data, error } = await supabase
        .from('mobs')
        .insert([{
          name: mobName.trim(),
          invite_code: inviteCode,
          owner_user_id: userData.user.id
        }])
        .select('*')
        .single();

      if (error) throw error;

      setCurrentMob(data);
      setMobName('');
      setShowCreateForm(false);
      Alert.alert('Success!', `Mob "${data.name}" created!\nInvite code: ${data.invite_code}`);
      
      // Reload to get updated data
      await loadUserMob();
    } catch (e: any) {
      console.error('createMob error:', e);
      Alert.alert('Error', 'Failed to create mob: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function joinMob() {
    if (!inviteCode.trim()) {
      Alert.alert('Error', 'Please enter an invite code');
      return;
    }

    try {
      setLoading(true);
      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user) throw new Error('Not authenticated');

      // Find mob by invite code
      const { data: mobData, error: mobError } = await supabase
        .from('mobs')
        .select('*')
        .eq('invite_code', inviteCode.trim().toUpperCase())
        .single();

      if (mobError || !mobData) {
        Alert.alert('Error', 'Invalid invite code');
        return;
      }

      // Join mob
      const { error: joinError } = await supabase
        .from('mob_members')
        .insert([{
          mob_id: mobData.id,
          user_id: userData.user.id
        }]);

      if (joinError) {
        if (joinError.code === '23505') { // Unique constraint violation
          Alert.alert('Error', 'You are already in a mob. Leave your current mob first.');
        } else {
          throw joinError;
        }
        return;
      }

      setCurrentMob(mobData);
      setInviteCode('');
      setShowJoinForm(false);
      Alert.alert('Success!', `Joined mob "${mobData.name}"!`);
      
      // Reload to get updated data
      await loadUserMob();
    } catch (e: any) {
      console.error('joinMob error:', e);
      Alert.alert('Error', 'Failed to join mob: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function leaveMob() {
    if (!currentMob) return;

    Alert.alert(
      'Leave Mob',
      `Are you sure you want to leave "${currentMob.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            try {
              const { data: userData } = await supabase.auth.getUser();
              if (!userData?.user) return;

              await supabase
                .from('mob_members')
                .delete()
                .eq('user_id', userData.user.id);

              setCurrentMob(null);
              setMobMembers([]);
              setTotalSpotsOwned(0);
              Alert.alert('Success', 'Left the mob');
            } catch (e: any) {
              Alert.alert('Error', 'Failed to leave mob: ' + e.message);
            }
          }
        }
      ]
    );
  }

  async function onRefresh() {
    setRefreshing(true);
    try {
      await loadUserMob();
    } catch (e: any) {
      console.error('Refresh error:', e);
    } finally {
      setRefreshing(false);
    }
  }

  function getAvatarUrl(avatarPath?: string) {
    if (!avatarPath) return null;
    return supabase.storage.from('spots-photos').getPublicUrl(avatarPath).data.publicUrl;
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>👥 My Mob</Text>
        </View>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </View>
    );
  }

  if (!currentMob) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>👥 My Mob</Text>
          <Text style={styles.subtitle}>Join forces to dominate spots</Text>
        </View>
        
        <ScrollView 
          style={styles.scrollContainer}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
        >
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>You're not in a mob yet!</Text>
            <Text style={styles.sectionText}>
              Create your own mob or join an existing one with an invite code.
            </Text>
          </View>

          <View style={styles.section}>
            <TouchableOpacity 
              style={styles.primaryButton} 
              onPress={() => setShowCreateForm(!showCreateForm)}
            >
              <Text style={styles.primaryButtonText}>🏗️ Create New Mob</Text>
            </TouchableOpacity>

            {showCreateForm && (
              <View style={styles.formContainer}>
                <TextInput
                  style={styles.input}
                  placeholder="Enter mob name (e.g., 'Street Legends')"
                  value={mobName}
                  onChangeText={setMobName}
                  maxLength={30}
                />
                <View style={styles.buttonRow}>
                  <TouchableOpacity style={styles.createButton} onPress={createMob}>
                    <Text style={styles.buttonText}>Create</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={styles.cancelButton} 
                    onPress={() => {
                      setShowCreateForm(false);
                      setMobName('');
                    }}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

          <View style={styles.section}>
            <TouchableOpacity 
              style={styles.secondaryButton} 
              onPress={() => setShowJoinForm(!showJoinForm)}
            >
              <Text style={styles.secondaryButtonText}>🎫 Join with Invite Code</Text>
            </TouchableOpacity>

            {showJoinForm && (
              <View style={styles.formContainer}>
                <TextInput
                  style={styles.input}
                  placeholder="Enter 6-digit invite code"
                  value={inviteCode}
                  onChangeText={setInviteCode}
                  maxLength={6}
                  autoCapitalize="characters"
                />
                <View style={styles.buttonRow}>
                  <TouchableOpacity style={styles.joinButton} onPress={joinMob}>
                    <Text style={styles.buttonText}>Join</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={styles.cancelButton} 
                    onPress={() => {
                      setShowJoinForm(false);
                      setInviteCode('');
                    }}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>👥 {currentMob.name}</Text>
        <Text style={styles.subtitle}>Invite Code: {currentMob.invite_code}</Text>
      </View>
      
      <ScrollView 
        style={styles.scrollContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
      >
        {/* Mob Stats */}
        <View style={styles.section}>
          <View style={styles.statsContainer}>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>{totalSpotsOwned}</Text>
              <Text style={styles.statLabel}>Total Spots Owned</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>{mobMembers.length}</Text>
              <Text style={styles.statLabel}>Members</Text>
            </View>
          </View>
        </View>

        {/* Members List */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Members</Text>
          {mobMembers.map((member) => (
            <TouchableOpacity key={member.id} style={styles.memberCard}
              onPress={() => navigation.navigate('Profile', { userId: member.user_id })}
            >
              <View style={styles.memberAvatar}>
                {member.profiles?.avatar_url ? (
                  <Image 
                    source={{ uri: getAvatarUrl(member.profiles.avatar_url) }} 
                    style={styles.avatar}
                  />
                ) : (
                  <View style={styles.avatarPlaceholder}>
                    <Text style={styles.avatarText}>👤</Text>
                  </View>
                )}
              </View>
              <View style={styles.memberInfo}>
                <Text style={styles.memberUsername}>
                  @{member.profiles?.username || 'anonymous'}
                  {member.user_id === currentMob.owner_user_id && ' 👑'}
                </Text>
                <Text style={styles.memberDisplayName}>
                  {member.profiles?.display_name || 'User'}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Actions */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.leaveButton} onPress={leaveMob}>
            <Text style={styles.leaveButtonText}>Leave Mob</Text>
          </TouchableOpacity>
        </View>
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
  subtitle: { fontSize: 16, color: colors.textSecondary },
  
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontSize: 16, color: colors.textSecondary },
  
  scrollContainer: { flex: 1 },
  section: { padding: 20, borderBottomWidth: 1, borderBottomColor: colors.border },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 8, color: colors.text },
  sectionText: { fontSize: 14, color: colors.textSecondary, marginBottom: 16 },
  
  primaryButton: { backgroundColor: colors.primary, padding: 16, borderRadius: 8, alignItems: 'center', marginBottom: 12 },
  primaryButtonText: { color: colors.text, fontSize: 16, fontWeight: 'bold' },
  secondaryButton: { backgroundColor: colors.success, padding: 16, borderRadius: 8, alignItems: 'center' },
  secondaryButtonText: { color: colors.text, fontSize: 16, fontWeight: 'bold' },
  
  formContainer: { marginTop: 16, padding: 16, backgroundColor: colors.surface, borderRadius: 8 },
  input: { borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 16, backgroundColor: colors.input, color: colors.text },
  buttonRow: { flexDirection: 'row', gap: 8 },
  createButton: { flex: 1, backgroundColor: colors.primary, padding: 12, borderRadius: 8, alignItems: 'center' },
  joinButton: { flex: 1, backgroundColor: colors.success, padding: 12, borderRadius: 8, alignItems: 'center' },
  cancelButton: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 12, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: colors.text, fontWeight: 'bold' },
  cancelButtonText: { color: colors.textSecondary, fontWeight: 'bold' },
  
  statsContainer: { flexDirection: 'row', gap: 16 },
  statCard: { flex: 1, backgroundColor: colors.surface, padding: 20, borderRadius: 12, alignItems: 'center' },
  statNumber: { fontSize: 28, fontWeight: 'bold', color: colors.primary },
  statLabel: { fontSize: 14, color: colors.textSecondary, marginTop: 4 },
  
  memberCard: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: colors.surface, borderRadius: 8, marginBottom: 8 },
  memberAvatar: { marginRight: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarPlaceholder: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceVariant, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, color: colors.textSecondary },
  memberInfo: { flex: 1 },
  memberUsername: { fontSize: 16, fontWeight: 'bold', color: colors.primary },
  memberDisplayName: { fontSize: 14, color: colors.textSecondary },
  
  leaveButton: { backgroundColor: colors.error, padding: 16, borderRadius: 8, alignItems: 'center' },
  leaveButtonText: { color: colors.text, fontSize: 16, fontWeight: 'bold' }
});
