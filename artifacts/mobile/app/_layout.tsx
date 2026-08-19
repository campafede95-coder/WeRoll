import React, { PropsWithChildren, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { ActivityIndicator, View } from 'react-native';
import { setBaseUrl, setGuestIdentityGetter } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();
const domain = process.env.EXPO_PUBLIC_DOMAIN;
if (domain) setBaseUrl(`https://${domain}`);

const queryClient = new QueryClient();
function GuestIdentityBootstrap({ children }: PropsWithChildren) {
  const [ready, setReady] = useState(false);
  const colors = useColors();
  useEffect(() => {
    const prepare = async () => {
      const existing = await AsyncStorage.getItem('pic-sync-guest-id');
      const id = existing ?? `guest-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      if (!existing) await AsyncStorage.setItem('pic-sync-guest-id', id);
      setGuestIdentityGetter(async () => ({ id, displayName: (await AsyncStorage.getItem('pic-sync-guest-name')) || 'Partecipante' }));
      setReady(true);
    };
    void prepare();
    return () => setGuestIdentityGetter(null);
  }, []);
  if (!ready) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}><ActivityIndicator color={colors.primary} /></View>;
  return <>{children}</>;
}

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false, headerBackTitle: 'Indietro' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="join" options={{ presentation: 'modal' }} />
      <Stack.Screen name="experience/create" options={{ presentation: 'modal' }} />
      <Stack.Screen name="experience/[id]" />
      <Stack.Screen name="capture/[id]" />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const experienceId = response.notification.request.content.data?.experienceId;
      if (typeof experienceId === 'string') router.push(`/capture/${experienceId}` as never);
    });
    return () => subscription.remove();
  }, []);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GuestIdentityBootstrap>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <KeyboardProvider><RootLayoutNav /></KeyboardProvider>
            </GestureHandlerRootView>
          </GuestIdentityBootstrap>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
