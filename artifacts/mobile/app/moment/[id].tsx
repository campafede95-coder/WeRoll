import React, { useEffect, useMemo, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { getGetExperienceQueryKey, useGetExperience } from '@workspace/api-client-react';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

const PHOTO_WINDOW_MS = 15 * 60 * 1000;
const TEST_PHOTO_WINDOW_MS = 30 * 1000;

function formatCountdown(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function PhotoMomentScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, reminderId, scheduledAt, test, notificationId, source } = useLocalSearchParams<{ id: string; reminderId?: string; scheduledAt?: string; test?: string; notificationId?: string; source?: string }>();
  const isTest = test === 'true';
  const experience = useGetExperience(id, { query: { queryKey: getGetExperienceQueryKey(id), enabled: Boolean(id) && !isTest } }).data;
  const reminder = useMemo(() => experience?.reminders.find((item) => item.id === reminderId), [experience?.reminders, reminderId]);
  const startTime = useMemo(() => {
    const value = scheduledAt || reminder?.scheduledAt;
    const parsed = value ? new Date(value).getTime() : Date.now();
    return Number.isFinite(parsed) ? parsed : Date.now();
  }, [reminder?.scheduledAt, scheduledAt]);
  const endTime = startTime + (isTest ? TEST_PHOTO_WINDOW_MS : PHOTO_WINDOW_MS);
  const [now, setNow] = useState(Date.now());
  const remaining = Math.max(0, endTime - now);
  const expired = remaining <= 0;

  useEffect(() => {
    if (expired) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expired]);

  const closeMoment = async () => {
    if (notificationId && Platform.OS !== 'web') {
      try {
        await Notifications.dismissNotificationAsync(notificationId);
      } catch {
        // The notification may already be dismissed by the operating system.
      }
    }
    router.dismissTo({
      pathname: '/experience/[id]',
      params: {
        id: experience?.id ?? id,
        ...(isTest || !reminderId || !scheduledAt ? {} : { momentReminderId: reminderId, momentScheduledAt: scheduledAt }),
      },
    });
  };

  return (
    <View style={[styles.page, { backgroundColor: colors.background, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Chiudi countdown"
          testID="photo-window-close"
          onPress={() => void closeMoment()}
          style={({ pressed }) => [styles.closeButton, { backgroundColor: colors.card }, pressed && styles.pressed]}
        >
          <Feather name="x" size={22} color={colors.foreground} />
        </Pressable>
      </View>
      <View style={styles.content}>
        <View style={[styles.iconCircle, { backgroundColor: colors.secondary }]}>
          <Feather name={expired ? 'clock' : 'camera'} size={67} color={colors.primary} />
        </View>
        {isTest ? <View style={[styles.testPill, { backgroundColor: colors.accent }]}><Feather name="radio" size={13} color={colors.accentForeground} /><Text style={[styles.testPillText, { color: colors.accentForeground }]}>PROVA AVVISO · SOLO TU</Text></View> : null}
        <Text style={[styles.title, { color: colors.foreground }]}>{expired ? 'Tempo scaduto' : isTest ? 'Countdown di prova' : 'Scatta una foto!'}</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{expired ? 'La finestra per questo ricordo è terminata' : isTest ? 'Controlla suono e vibrazione · questa foto non sarà salvata' : 'Tempo rimasto'}</Text>
        <Text accessibilityLabel={`${formatCountdown(remaining)} rimanenti`} testID="photo-window-countdown" style={[styles.countdown, { color: expired ? colors.mutedForeground : colors.primary }]}>{formatCountdown(remaining)}</Text>
        {!isTest && reminder?.title ? <Text style={[styles.reminderTitle, { color: colors.mutedForeground }]}>{reminder.title}</Text> : null}
      </View>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isTest ? 'Scatta foto di prova senza salvare' : 'Scatta foto'}
          testID="photo-window-capture"
          disabled={expired}
          onPress={() => router.push({
            pathname: '/capture/[id]',
            params: {
              id: experience?.id ?? id,
              autoCamera: 'true',
              ...(isTest ? { test: 'true' } : {}),
              ...(reminderId ? { reminderId } : {}),
              ...(scheduledAt ? { scheduledAt } : {}),
            },
          })}
          style={({ pressed }) => [styles.primaryAction, { backgroundColor: expired ? colors.muted : colors.primary }, pressed && !expired && styles.pressed]}
        >
          <Feather name="camera" size={23} color={expired ? colors.mutedForeground : colors.primaryForeground} />
          <Text style={[styles.primaryLabel, { color: expired ? colors.mutedForeground : colors.primaryForeground }]}>{isTest ? 'Scatta prova' : 'Scatta foto'}</Text>
        </Pressable>
        {isTest || expired ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isTest ? 'Chiudi prova' : 'Torna alla sessione'}
            testID="photo-window-dismiss"
            onPress={() => void closeMoment()}
            style={({ pressed }) => [styles.returnAction, { borderColor: colors.border, backgroundColor: colors.card }, pressed && styles.pressed]}
          >
            <Text style={[styles.returnLabel, { color: colors.foreground }]}>{isTest ? 'Chiudi prova' : 'Torna alla sessione'}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 22 },
  topBar: { alignItems: 'flex-end' },
  closeButton: { width: 43, height: 43, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 28 },
  iconCircle: { width: 176, height: 176, borderRadius: 88, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 36, lineHeight: 42, letterSpacing: -1.1, textAlign: 'center', marginTop: 42 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 19, lineHeight: 26, textAlign: 'center', marginTop: 20 },
  countdown: { fontFamily: 'Inter_700Bold', fontSize: 60, lineHeight: 68, letterSpacing: -2.4, marginTop: 23, fontVariant: ['tabular-nums'] },
  reminderTitle: { fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 12 },
  testPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7 },
  testPillText: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1 },
  actions: { gap: 12 },
  primaryAction: { minHeight: 66, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  primaryLabel: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  returnAction: { minHeight: 52, borderWidth: 1, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  returnLabel: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
});