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
import { ActivityIndicator, AppState, Platform, View } from 'react-native';
import { setBaseUrl, setGuestIdentityGetter } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { ensurePhotoReminderChannel } from '@/constants/notifications';
import type { PhotoPromptVariant } from '@/constants/photoPrompts';
import { CLOSED_EXPERIENCES_STORAGE_KEY, rememberClosedExperience } from '@/constants/experience';
import { clearActiveReminder, loadActiveReminder, saveActiveReminder, type ActiveReminder } from '@/constants/activeReminder';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();
const configuredApiBaseUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
const developmentDomain = process.env.EXPO_PUBLIC_REPLIT_DEV_DOMAIN?.trim();
const developmentApiBaseUrl =
  configuredApiBaseUrl ||
  (developmentDomain ? `https://${developmentDomain}` : '');
const apiBaseUrl = __DEV__ ? developmentApiBaseUrl : configuredApiBaseUrl;
if (!apiBaseUrl) {
  throw new Error(
    __DEV__
      ? 'Development API URL is unavailable. Start the app through the Replit Expo workflow so REPLIT_DEV_DOMAIN can be injected.'
      : 'EXPO_PUBLIC_API_URL is required. Configure it with the stable API deployment URL before building the app.'
  );
}
if (!/^https:\/\//i.test(apiBaseUrl)) {
  throw new Error('EXPO_PUBLIC_API_URL must be an absolute HTTPS URL.');
}
if (!__DEV__ && new URL(apiBaseUrl).hostname.endsWith('.replit.dev')) {
  throw new Error('Standalone builds must use the stable API deployment URL, not a Replit development domain.');
}
setBaseUrl(apiBaseUrl);

const queryClient = new QueryClient();
const PHOTO_WINDOW_MS = 15 * 60 * 1000;
const TEST_PHOTO_WINDOW_MS = 30 * 1000;

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data;
    const experienceId = typeof data?.experienceId === 'string' ? data.experienceId : '';
    const isTest = data?.test === true || data?.test === 'true';
    const shouldPresent = isTest || !experienceId || !await isExperienceClosedRemotely(experienceId);
    return {
      shouldShowBanner: shouldPresent,
      shouldShowList: shouldPresent,
      shouldPlaySound: shouldPresent,
      shouldSetBadge: false,
    };
  },
});

function notificationMomentKey(notification: Notifications.Notification) {
  const data = notification.request.content.data;
  if (typeof data?.experienceId !== 'string' || typeof data?.scheduledAt !== 'string') return notification.request.identifier;
  return `${data.experienceId}:${typeof data.reminderId === 'string' ? data.reminderId : data.scheduledAt}`;
}

async function isExperienceLocallyClosed(experienceId: string) {
  const stored = await AsyncStorage.getItem(CLOSED_EXPERIENCES_STORAGE_KEY);
  if (!stored) return false;
  try {
    const closedExperiences = JSON.parse(stored) as unknown;
    return Array.isArray(closedExperiences) && closedExperiences.includes(experienceId);
  } catch {
    return false;
  }
}

async function isExperienceClosedRemotely(experienceId: string) {
  if (await isExperienceLocallyClosed(experienceId)) return true;
  try {
    const guestId = await AsyncStorage.getItem('pic-sync-guest-id');
    const response = await fetch(`${apiBaseUrl}/api/experiences/${encodeURIComponent(experienceId)}`, {
      headers: guestId ? { 'x-pic-sync-guest-id': guestId } : undefined,
    });
    if (!response.ok) return response.status === 404 || response.status === 403;
    const payload = await response.json() as { sessionStatus?: unknown };
    if (payload.sessionStatus === 'closed') {
      await rememberClosedExperience(experienceId);
      return true;
    }
    return false;
  } catch {
    // A temporary network failure must not prevent an already-received
    // reminder from opening while the user is offline.
    return false;
  }
}

async function openPhotoMomentData(active: ActiveReminder, messageVariant?: PhotoPromptVariant) {
  const scheduledTime = new Date(active.scheduledAt).getTime();
  const duration = active.isTest ? TEST_PHOTO_WINDOW_MS : PHOTO_WINDOW_MS;
  if (!Number.isFinite(scheduledTime) || scheduledTime + duration <= Date.now()) return false;
  if (!active.isTest && await isExperienceClosedRemotely(active.experienceId)) return false;
  await saveActiveReminder(active);
  router.push({
    pathname: '/moment/[id]',
    params: {
      id: active.experienceId,
      experienceId: active.experienceId,
      reminderId: active.reminderId ?? '',
      scheduledAt: active.scheduledAt,
      test: active.isTest ? 'true' : '',
      notificationId: active.notificationId ?? '',
      messageVariant: messageVariant ?? '',
    },
  });
  return true;
}

async function openPhotoMoment(notification: Notifications.Notification) {
  const data = notification.request.content.data;
  const experienceId = data?.experienceId;
  if (typeof experienceId !== 'string') return false;
  const scheduledAt = typeof data.scheduledAt === 'string' ? data.scheduledAt : new Date(notification.date).toISOString();
  const isTest = data?.test === true || data?.test === 'true';
  const messageVariant = data?.messageVariant === 'special' || data?.messageVariant === 'normal' ? data.messageVariant : undefined;
  return openPhotoMomentData({
    experienceId,
    reminderId: typeof data.reminderId === 'string' ? data.reminderId : undefined,
    scheduledAt,
    isTest,
    notificationId: notification.request.identifier,
  }, messageVariant);
}

function GuestIdentityBootstrap({ children }: PropsWithChildren) {
  const [ready, setReady] = useState(false);
  const colors = useColors();
  useEffect(() => {
    let cancelled = false;
    const prepare = async () => {
      try {
        // Do not accept an empty/corrupted persisted value: the API rejects it
        // as a missing identity, which otherwise only becomes visible after a
        // later app launch.
        const existing = (await AsyncStorage.getItem('pic-sync-guest-id'))?.trim();
        const id = existing || `guest-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        if (!existing) await AsyncStorage.setItem('pic-sync-guest-id', id);

        setGuestIdentityGetter(async () => ({
          id,
          displayName: (await AsyncStorage.getItem('pic-sync-guest-name'))?.trim() || 'Partecipante',
        }));
        if (!cancelled) setReady(true);
      } catch (error) {
        // A storage failure must not allow requests to proceed without an ID.
        console.error('Unable to initialize the guest identity', error);
      }
    };
    void prepare();
    return () => {
      cancelled = true;
      setGuestIdentityGetter(null);
    };
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
      <Stack.Screen name="capture/[id]" options={{ gestureEnabled: false }} />
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
    void ensurePhotoReminderChannel();
  }, []);

  useEffect(() => {
    if (!rootNavigationState?.key) return;
    const handleNotification = (notification: Notifications.Notification) => {
      const notificationKey = notificationMomentKey(notification);
      if (handledNotificationIds.current.has(notificationKey)) return;
      handledNotificationIds.current.add(notificationKey);
      void openPhotoMoment(notification).then((opened) => {
        if (!opened) handledNotificationIds.current.delete(notificationKey);
      });
    };
    const handleResponse = async (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      handleNotification(response.notification);
      if (Platform.OS !== 'web') await Notifications.clearLastNotificationResponseAsync();
    };
    const recoverActiveNotification = async () => {
      if (Platform.OS === 'web') return;
      const active = await loadActiveReminder();
      if (active) {
        const start = new Date(active.scheduledAt).getTime();
        const duration = active.isTest ? TEST_PHOTO_WINDOW_MS : PHOTO_WINDOW_MS;
        const notificationKey = `${active.experienceId}:${active.reminderId ?? active.scheduledAt}`;
        if (Number.isFinite(start) && start <= Date.now() && start + duration > Date.now() && !handledNotificationIds.current.has(notificationKey)) {
          handledNotificationIds.current.add(notificationKey);
          const opened = await openPhotoMomentData(active);
          if (opened) return;
          handledNotificationIds.current.delete(notificationKey);
        }
      }
      await clearActiveReminder();
      const presented = await Notifications.getPresentedNotificationsAsync();
      const activeNotification = presented
        .filter((notification) => {
          const data = notification.request.content.data;
          const start = typeof data?.scheduledAt === 'string' ? new Date(data.scheduledAt).getTime() : NaN;
          return typeof data?.experienceId === 'string' && Number.isFinite(start) && start <= Date.now() && start + PHOTO_WINDOW_MS > Date.now();
        })
        .sort((a, b) => b.date - a.date)[0];
      if (activeNotification) handleNotification(activeNotification);
    };
    const receivedSubscription = Notifications.addNotificationReceivedListener(handleNotification);
    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => void handleResponse(response));
    if (Platform.OS !== 'web') void Notifications.getLastNotificationResponseAsync().then(handleResponse);
    if (Platform.OS !== 'web') void recoverActiveNotification();
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void recoverActiveNotification();
    });
    return () => {
      receivedSubscription.remove();
      responseSubscription.remove();
      appStateSubscription.remove();
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
