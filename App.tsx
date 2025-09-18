import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { supabase } from './supabase';
import { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AuthScreen from './src/screens/AuthScreen';
import MapScreen from './src/screens/MapScreen';
import SpotScreen from './src/screens/SpotScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  const [session, setSession] = useState<any | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => { sub.subscription.unsubscribe(); };
  }, []);

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {session ? (
          <>
            <Stack.Screen name="Map" component={MapScreen} />
            <Stack.Screen name="Spot" component={SpotScreen} />
          </>
        ) : (
          <Stack.Screen name="Auth">
            {() => <AuthScreen onAuth={() => supabase.auth.getSession().then(({ data }) => setSession(data.session))} />}
          </Stack.Screen>
        )}
      </Stack.Navigator>
      <StatusBar style="auto" />
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
