import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, Linking } from 'react-native';
import { supabase } from '../../supabase';
import { colors } from '../constants/colors';
import { captureMessage } from '../config/sentry';
import logger from '../utils/logger';

export default function SettingsScreen({ navigation }: any) {
  const [loading, setLoading] = useState(false);
  const [shouldCrash, setShouldCrash] = useState(false);

  // Test function to trigger an error (for ErrorBoundary and Sentry testing)
  function testErrorBoundary() {
    Alert.alert(
      '🧪 Test Error Boundary & Sentry',
      'This will intentionally crash the app to test if the Error Boundary catches it and Sentry logs it. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Trigger Crash',
          style: 'destructive',
          onPress: () => {
            // Log some breadcrumbs before the crash (helps with debugging)
            logger.navigation('SettingsScreen', { action: 'test-error' });
            logger.tagged('TEST', 'About to trigger test error');
            captureMessage('Test: About to trigger intentional crash', 'info');
            
            // Trigger the crash
            setShouldCrash(true);
          }
        }
      ]
    );
  }

  // This will cause a render error that ErrorBoundary will catch and send to Sentry
  if (shouldCrash) {
    throw new Error('🧪 TEST ERROR: ErrorBoundary and Sentry test triggered from Settings screen');
  }

  async function requestAccountDeletion() {
    Alert.alert(
      'Delete Account',
      'Are you sure you want to delete your account? This action cannot be undone. All your data will be permanently removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              const { data: userData } = await supabase.auth.getUser();
              if (!userData?.user) {
                Alert.alert('Error', 'Not authenticated');
                return;
              }

              // Since we can't delete the user directly with anon key,
              // we'll insert a deletion request that admins can process
              const { error } = await supabase
                .from('account_deletion_requests')
                .insert([{
                  user_id: userData.user.id,
                  email: userData.user.email,
                  requested_at: new Date().toISOString()
                }]);

              if (error) {
                // If table doesn't exist, fall back to email
                console.error('Deletion request error:', error);
                const emailSubject = encodeURIComponent('Account Deletion Request');
                const emailBody = encodeURIComponent(`Please delete my account. User ID: ${userData.user.id}, Email: ${userData.user.email}`);
                await Linking.openURL(`mailto:dnlrbbrt@gmail.com?subject=${emailSubject}&body=${emailBody}`);
              }

              // Sign out the user
              await supabase.auth.signOut();
              
              Alert.alert(
                'Request Submitted',
                'Your account deletion request has been submitted. Your account will be deleted within 30 days.',
                [{ text: 'OK' }]
              );
            } catch (e: any) {
              console.error('Account deletion error:', e);
              Alert.alert('Error', 'Failed to submit deletion request. Please try again.');
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  }

  async function openPrivacyPolicy() {
    const privacyUrl = 'https://github.com/dnlrbbrt/mob-maps-917/blob/main/PRIVACY.md';
    try {
      await Linking.openURL(privacyUrl);
    } catch (e) {
      Alert.alert('Error', 'Could not open privacy policy. Please visit: ' + privacyUrl);
    }
  }

  async function openTermsOfService() {
    const termsUrl = 'https://github.com/dnlrbbrt/mob-maps-917/blob/main/TERMS.md';
    try {
      await Linking.openURL(termsUrl);
    } catch (e) {
      Alert.alert('Error', 'Could not open terms of service. Please visit: ' + termsUrl);
    }
  }

  async function contactSupport() {
    const emailSubject = encodeURIComponent('Support Request');
    const emailBody = encodeURIComponent('Please describe your issue:\n\n');
    await Linking.openURL(`mailto:dnlrbbrt@gmail.com?subject=${emailSubject}&body=${emailBody}`);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={navigation.goBack} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView style={styles.scrollContainer}>
        {/* Legal Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Legal</Text>
          
          <TouchableOpacity style={styles.settingItem} onPress={openPrivacyPolicy}>
            <Text style={styles.settingText}>Privacy Policy</Text>
            <Text style={styles.settingArrow}>→</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.settingItem} onPress={openTermsOfService}>
            <Text style={styles.settingText}>Terms of Service</Text>
            <Text style={styles.settingArrow}>→</Text>
          </TouchableOpacity>
        </View>

        {/* Support Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Support</Text>
          
          <TouchableOpacity style={styles.settingItem} onPress={contactSupport}>
            <Text style={styles.settingText}>Contact Support</Text>
            <Text style={styles.settingArrow}>→</Text>
          </TouchableOpacity>

          {/* TEST BUTTON - Remove after ErrorBoundary & Sentry verification */}
          {__DEV__ && (
            <TouchableOpacity 
              style={[styles.settingItem, styles.testButton]} 
              onPress={testErrorBoundary}
            >
              <Text style={styles.testButtonText}>🧪 Test Error Boundary & Sentry (DEV)</Text>
              <Text style={styles.settingArrow}>💥</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Account Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          
          <TouchableOpacity 
            style={styles.signOutButton} 
            onPress={async () => {
              Alert.alert(
                'Sign Out',
                'Are you sure you want to sign out?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Sign Out',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        await supabase.auth.signOut();
                      } catch (e) {
                        console.error('Sign out error:', e);
                        Alert.alert('Error', 'Failed to sign out');
                      }
                    }
                  }
                ]
              );
            }}
          >
            <Text style={styles.signOutButtonText}>Sign Out</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.deleteButton, loading && styles.buttonDisabled]} 
            onPress={requestAccountDeletion}
            disabled={loading}
          >
            <Text style={styles.deleteButtonText}>
              {loading ? 'Processing...' : 'Delete Account'}
            </Text>
          </TouchableOpacity>

          <Text style={styles.deleteWarning}>
            Deleting your account will permanently remove all your data, including spots, clips, and votes. 
            This action cannot be undone.
          </Text>
        </View>

        {/* App Info */}
        <View style={styles.section}>
          <Text style={styles.appInfo}>Mob Maps v1.0.0</Text>
          <Text style={styles.appInfoSubtext}>
            Find and claim skate spots. Battle for territory.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: colors.background 
  },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: 16, 
    paddingTop: 48, 
    borderBottomWidth: 1, 
    borderBottomColor: colors.border 
  },
  backButton: { 
    marginRight: 16 
  },
  backText: { 
    fontSize: 16, 
    color: colors.primary 
  },
  title: { 
    flex: 1, 
    fontSize: 20, 
    fontWeight: 'bold', 
    color: colors.text 
  },
  scrollContainer: { 
    flex: 1 
  },
  section: { 
    padding: 20, 
    borderBottomWidth: 1, 
    borderBottomColor: colors.border 
  },
  sectionTitle: { 
    fontSize: 16, 
    fontWeight: 'bold', 
    color: colors.textSecondary, 
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  settingItem: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center',
    paddingVertical: 12, 
    borderBottomWidth: 1, 
    borderBottomColor: colors.border 
  },
  settingText: { 
    fontSize: 16, 
    color: colors.text 
  },
  settingArrow: { 
    fontSize: 16, 
    color: colors.textSecondary 
  },
  signOutButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16
  },
  signOutButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600'
  },
  deleteButton: { 
    backgroundColor: colors.error, 
    paddingVertical: 14, 
    paddingHorizontal: 20, 
    borderRadius: 8, 
    alignItems: 'center',
    marginBottom: 12
  },
  buttonDisabled: {
    opacity: 0.6
  },
  deleteButtonText: { 
    color: colors.text, 
    fontSize: 16, 
    fontWeight: 'bold' 
  },
  deleteWarning: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    textAlign: 'center'
  },
  appInfo: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 4
  },
  appInfoSubtext: {
    fontSize: 12,
    color: colors.textTertiary,
    textAlign: 'center',
    fontStyle: 'italic'
  },
  testButton: {
    backgroundColor: 'rgba(255, 152, 0, 0.1)',
    borderWidth: 2,
    borderColor: 'rgba(255, 152, 0, 0.3)',
    borderRadius: 8,
    marginTop: 8
  },
  testButtonText: {
    fontSize: 15,
    color: '#ff9800',
    fontWeight: '600'
  }
});
