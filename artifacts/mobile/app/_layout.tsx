import React, { PropsWithChildren, useEffect, useRef, useState } from 'react';
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
import { Stack, router, useRootNavigationState } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { ActivityIndicator, Platform, View } from 'react-native';
import { setBaseUrl, setGuestIdentityGetter } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();
const domain = process.env.EXPO_PUBLIC_DOMAIN;
if (domain) setBaseUrl(`https://${domain}`);

const queryClient = new QueryClient();
const PHOTO_REMINDER_CHANNEL = 'pic-sync-reminders';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

function openPhotoMoment(notification: Notifications.Notification) {
  const data = notification.request.content.data;
  const experienceId = data?.experienceId;
  if (typeof experienceId !== 'string') return false;
  router.push({
    pathname: '/moment/[id]',
    params: {
      id: experienceId,
      reminderId: typeof data.reminderId === 'string' ? data.reminderId : '',
      scheduledAt: typeof data.scheduledAt === 'string' ? data.scheduledAt : new Date(notification.date).toISOString(),
    },
  });
  return true;
}

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
      <Stack.Screen name="moment/[id]" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
      <Stack.Screen name="capture/[id]" />
    </Stack>
  );
}

export default function RootLayout() {
  const rootNavigationState = useRootNavigationState();
  const handledNotificationIds = useRef<Set<string>>(new Set());
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
    if (Platform.OS === 'android') {
      void Notifications.setNotificationChannelAsync(PHOTO_REMINDER_CHANNEL, {
        name: 'Promemoria foto',
        description: 'Sveglie brevi per i momenti fotografici del gruppo',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
        enableVibrate: true,
        vibrationPattern: [0, 250, 140, 250],
      });
    }
  }, []);

  useEffect(() => {
    if (!rootNavigationState?.key) return;
    const handleNotification = (notification: Notifications.Notification) => {
      const notificationId = notification.request.identifier;
      if (handledNotificationIds.current.has(notificationId)) return;
      if (openPhotoMoment(notification)) handledNotificationIds.current.add(notificationId);
    };
    const handleResponse = async (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      handleNotification(response.notification);
      if (Platform.OS !== 'web') await Notifications.clearLastNotificationResponseAsync();
    };
    const receivedSubscription = Notifications.addNotificationReceivedListener(handleNotification);
    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => void handleResponse(response));
    if (Platform.OS !== 'web') void Notifications.getLastNotificationResponseAsync().then(handleResponse);
    return () => {
      receivedSubscription.remove();
      responseSubscription.remove();
    };
  }, [rootNavigationState?.key]);

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
