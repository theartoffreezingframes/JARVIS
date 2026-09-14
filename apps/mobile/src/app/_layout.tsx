/**
 * Root layout: providers, appearance, session gate and the splash handoff.
 */
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../lib/auth';
import { hydrateOffline, useConnectivityWatch } from '../lib/offline';
import { hydrateCache, useForegroundRefresh } from '../lib/query';
import { hydrateFocusTimer } from '../lib/timer';
import { usePalette } from '../lib/theme';
import { useNotifications } from '../hooks/useNotifications';
import { LoadingBlock } from '../components/ui';

void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      await Promise.all([hydrateCache(), hydrateOffline(), hydrateFocusTimer()]);
      setReady(true);
      await SplashScreen.hideAsync().catch(() => {});
    })();
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0B0F19', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="sparkles" size={40} color="#7C83F5" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <AppShell />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AppShell() {
  const palette = usePalette();
  const { status } = useAuth();
  useConnectivityWatch();
  useForegroundRefresh();
  useNotifications();

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: palette.background, justifyContent: 'center' }}>
        <LoadingBlock label="Opening JARVIS" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style={palette.text === '#F7F8FA' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.background },
          animation: 'fade',
        }}
      >
        {status === 'signedIn' ? (
          <>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="task-new" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="task/[id]" />
            <Stack.Screen name="habits" />
            <Stack.Screen name="analytics" />
            <Stack.Screen name="projects" />
            <Stack.Screen name="project/[id]" />
            <Stack.Screen name="notes" />
            <Stack.Screen name="note/[id]" />
            <Stack.Screen name="calendar" />
            <Stack.Screen name="planner" />
            <Stack.Screen name="review" />
            <Stack.Screen name="search" />
            <Stack.Screen name="groups" />
            <Stack.Screen name="group/[id]" />
            <Stack.Screen name="gang/[id]" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="notifications" />
            <Stack.Screen name="settings" />
          </>
        ) : (
          <>
            <Stack.Screen name="sign-in" />
            <Stack.Screen name="sign-up" />
            <Stack.Screen name="forgot-password" />
          </>
        )}
      </Stack>
    </>
  );
}
