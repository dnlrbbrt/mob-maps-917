import { useState } from 'react';
import { View, TextInput, Button, Text, StyleSheet } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '../../supabase';

export default function AuthScreen({ onAuth }: { onAuth: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return setError(error.message);
    if (data.session) {
      await SecureStore.setItemAsync('sb-access-token', data.session.access_token);
      onAuth();
    }
  }

  async function signUp() {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) return setError(error.message);
    setError('Check your email to confirm your account.');
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sign in</Text>
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        secureTextEntry
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.row}>
        <Button title={loading ? '...' : 'Sign In'} onPress={signIn} disabled={loading} />
        <View style={{ width: 12 }} />
        <Button title="Sign Up" onPress={signUp} disabled={loading} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { fontSize: 24, marginBottom: 16 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12
  },
  error: { color: 'red', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }
});


