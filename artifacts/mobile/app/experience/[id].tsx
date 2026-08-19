import React, { useEffect, useMemo, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { getGetExperienceQueryKey, useCloseExperience, useGetExperience, useStartExperience, useUpdateReminder } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Alert, Linking, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { AppHeader, EmptyState, ErrorState, PrimaryButton, Screen, SkeletonList, Surface } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';

function partsFor(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (kind: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === kind)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

function dateAtGroupTime(reference: string, hour: number, minute: number, timeZone: string) {
  const current = partsFor(new Date(reference), timeZone);
  const intended = Date.UTC(current.year, current.month - 1, current.day, hour, minute);
  const provisional = new Date(intended);
  const represented = partsFor(provisional, timeZone);
  const offset = Date.UTC(represented.year, represented.month - 1, represented.day, represented.hour, represented.minute) - provisional.getTime();
  return new Date(intended - offset);
}

function timeFromDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('it-IT', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
}

function toMinutes(time?: string | null) {
  if (!time) return 0;
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

type EditingReminder = { id: string; hour: number; minute: number } | null;
type TestNotificationState = 'idle' | 'scheduled';

const TEST_NOTIFICATION_DELAY_SECONDS = 5;

export default function GroupSessionScreen() {
  const colors = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const query = useGetExperience(id, { query: { queryKey: getGetExperienceQueryKey(id), enabled: Boolean(id), refetchInterval: 5000 } });
  const start = useStartExperience();
  const close = useCloseExperience();
  const updateReminder = useUpdateReminder();
  const [editing, setEditing] = useState<EditingReminder>(null);
  const [testNotificationState, setTestNotificationState] = useState<TestNotificationState>('idle');
  const group = query.data;
  const nextReminder = useMemo(() => group?.reminders.find((reminder) => new Date(reminder.scheduledAt).getTime() > Date.now()), [group?.reminders]);

  useEffect(() => {
    if (testNotificationState !== 'scheduled') return;
    const reset = setTimeout(() => setTestNotificationState('idle'), (TEST_NOTIFICATION_DELAY_SECONDS + 4) * 1000);
    return () => clearTimeout(reset);
  }, [testNotificationState]);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: getGetExperienceQueryKey(id) });
  const sendTestNotification = async () => {
    if (!group || !group.isOwner || testNotificationState === 'scheduled') return;
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
      Alert.alert('Prova su telefono', 'Apri Pic Sync su iPhone o Android per verificare suono, vibrazione e fotocamera.');
      return;
    }

    const current = await Notifications.getPermissionsAsync();
    const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
    if (!permission.granted) {
      if (!permission.canAskAgain) {
        Alert.alert(
          'Avvisi disattivati',
          'Per provare suono e vibrazione, abilita le notifiche di Pic Sync dalle impostazioni del telefono.',
          [{ text: 'Apri impostazioni', onPress: () => void Linking.openSettings() }, { text: 'Annulla', style: 'cancel' }],
        );
      } else {
        Alert.alert('Avvisi non abilitati', 'Consenti le notifiche per ricevere la sveglia di prova.');
      }
      return;
    }

    const scheduledAt = new Date(Date.now() + TEST_NOTIFICATION_DELAY_SECONDS * 1000).toISOString();
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Prova avviso',
          body: 'Suono e vibrazione · tocca per aprire il countdown di prova.',
          sound: 'default',
          data: { experienceId: group.id, scheduledAt, test: true },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(scheduledAt),
          channelId: 'pic-sync-reminders-v2',
        },
      });
      setTestNotificationState('scheduled');
    } catch {
      Alert.alert('Prova non programmata', 'Non riusciamo a programmare la sveglia di prova. Riprova tra un momento.');
    }
  };
  const startSession = () => { if (id) start.mutate({ experienceId: id }, { onSuccess: refresh }); };
  const closeSession = () => {
    if (!id) return;
    close.mutate({ experienceId: id }, { onSuccess: refresh });
  };
  const saveReminder = () => {
    if (!group || !editing || !id) return;
    const reminder = group.reminders.find((item) => item.id === editing.id);
    if (!reminder) return;
    updateReminder.mutate({
      experienceId: id,
      reminderId: reminder.id,
      data: { title: reminder.title, message: reminder.message, scheduledAt: dateAtGroupTime(reminder.scheduledAt, editing.hour, editing.minute, group.timeZone).toISOString() },
    }, { onSuccess: () => { setEditing(null); refresh(); } });
  };

  if (query.isLoading) return <Screen><AppHeader title="Gruppo" back /><SkeletonList /></Screen>;
  if (query.isError || !group) return <Screen><AppHeader title="Gruppo" back /><ErrorState onRetry={() => void query.refetch()} /></Screen>;

  if (group.sessionStatus === 'closed') {
    return <Screen><AppHeader title="Album finale" back /><Text style={[styles.eyebrow, { color: colors.primary }]}>SESSIONE CONCLUSA</Text><Text style={[styles.title, { color: colors.foreground }]}>Tutti i vostri{'\n'}ricordi insieme.</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>{group.memories.length} foto raccolte durante l&apos;avventura.</Text>{group.memories.length ? <View style={styles.album}>{group.memories.map((memory) => <View key={memory.id} style={styles.memory}><Image source={{ uri: memory.imageUri }} contentFit="cover" style={styles.memoryImage} /><Text numberOfLines={1} style={[styles.memoryAuthor, { color: colors.foreground }]}>{memory.authorName}</Text></View>)}</View> : <EmptyState icon="image" title="Nessuna foto ancora" body="Le foto scattate verranno raccolte qui." />}<PrimaryButton label="Condividi l'album" icon="share-2" onPress={() => void Share.share({ message: `Album Pic Sync · ${group.name} · ${group.memories.length} ricordi raccolti.` })} style={{ marginTop: 22 }} /></Screen>;
  }

  const hours = Array.from({ length: Math.floor(toMinutes(group.windowEnd) / 60) - Math.floor(toMinutes(group.windowStart) / 60) + 1 }, (_, index) => Math.floor(toMinutes(group.windowStart) / 60) + index);
  const minuteOptions = editing ? Array.from({ length: 60 }, (_, index) => index).filter((minute) => {
    const value = editing.hour * 60 + minute;
    return value >= toMinutes(group.windowStart) && value <= toMinutes(group.windowEnd);
  }) : [];
  const waitingRoom = group.sessionStatus === 'lobby' && !group.isOwner;

  return (
    <Screen>
      <AppHeader title={waitingRoom ? 'In attesa' : group.sessionStatus === 'active' ? 'Sessione attiva' : 'Imposta sveglie'} back action={<View style={styles.people}><Feather name="users" size={18} color={colors.mutedForeground} /><Text style={[styles.peopleText, { color: colors.foreground }]}>{group.participantCount}</Text></View>} />
      <Surface style={styles.summary}>
        <Summary label="Codice" value={group.inviteCode} accent />
        <Summary label="Fascia oraria" value={`${group.windowStart} – ${group.windowEnd}`} />
        <Summary label="Foto totali" value={String(group.targetPhotoCount)} />
        <Summary label="Partecipanti" value={String(group.participantCount)} />
      </Surface>

      {waitingRoom ? (
        <>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>In attesa dell&apos;organizzatore</Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>Sei nel gruppo! Le sveglie sono a sorpresa — riceverai una notifica quando arriva il momento di scattare.</Text>
          <View style={styles.roster}>{group.participants.map((participant) => <Surface key={participant.id} style={styles.person}><Text style={[styles.personName, { color: colors.foreground }]}>{participant.displayName}{participant.isOrganizer ? ' ✨' : ''}</Text><Text style={[styles.personRole, { color: colors.mutedForeground }]}>{participant.isOrganizer ? 'Organizzatore' : 'tu'}</Text></Surface>)}</View>
          <View style={styles.waitNote}><Text style={[styles.waitEmoji]}>⌛</Text><Text style={[styles.waitText, { color: colors.mutedForeground }]}>Attendi che l&apos;organizzatore avvii la sessione…</Text></View>
        </>
      ) : group.sessionStatus === 'lobby' ? (
        <>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Prepara le sveglie</Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>Tocca un orario per modificarlo. Ogni sveglia resta sempre nella fascia {group.windowStart} – {group.windowEnd}.</Text>
          <Text style={[styles.listTitle, { color: colors.foreground }]}>Sveglie programmate</Text>
          <View style={styles.reminderList}>{group.reminders.map((reminder) => <Pressable key={reminder.id} accessibilityRole="button" accessibilityLabel={`Modifica sveglia delle ${timeFromDate(reminder.scheduledAt, group.timeZone)}`} onPress={() => { const current = partsFor(new Date(reminder.scheduledAt), group.timeZone); setEditing({ id: reminder.id, hour: current.hour, minute: current.minute }); }} style={[styles.reminder, { borderColor: colors.border, backgroundColor: colors.card }]}><Feather name="clock" size={23} color={colors.primary} /><Text style={[styles.reminderHour, { color: colors.foreground }]}>{timeFromDate(reminder.scheduledAt, group.timeZone)}</Text><Feather name="chevron-right" size={18} color={colors.mutedForeground} /></Pressable>)}</View>
          <Text style={[styles.rosterTitle, { color: colors.foreground }]}>Partecipanti ({group.participantCount})</Text>
          <View style={styles.roster}>{group.participants.map((participant) => <Surface key={participant.id} style={styles.person}><Text style={[styles.personName, { color: colors.foreground }]}>{participant.displayName}{participant.isOrganizer ? ' ✨' : ''}</Text><Text style={[styles.personRole, { color: colors.mutedForeground }]}>{participant.isOrganizer ? 'Organizzatore' : 'Nel gruppo'}</Text></Surface>)}</View>
          <PrimaryButton label="Avvia sessione" icon="play" onPress={startSession} loading={start.isPending} style={{ marginTop: 24 }} />
          {group.isOwner ? (
            <Surface style={styles.testCard}>
              <View style={[styles.testIcon, { backgroundColor: colors.secondary }]}><Feather name="volume-2" size={19} color={colors.primary} /></View>
              <View style={styles.testCopy}>
                <Text style={[styles.testTitle, { color: colors.foreground }]}>Prova avviso</Text>
                <Text style={[styles.testBody, { color: colors.mutedForeground }]}>Solo tu · tra {TEST_NOTIFICATION_DELAY_SECONDS} secondi · non modifica sessione o album</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={testNotificationState === 'scheduled' ? 'Sveglia di prova programmata' : 'Invia sveglia di prova'}
                testID="send-test-notification"
                disabled={testNotificationState === 'scheduled'}
                onPress={() => void sendTestNotification()}
                style={({ pressed }) => [styles.testButton, { backgroundColor: testNotificationState === 'scheduled' ? colors.muted : colors.primary }, pressed && styles.pressed]}
              >
                <Feather name={testNotificationState === 'scheduled' ? 'check' : 'play'} size={16} color={testNotificationState === 'scheduled' ? colors.mutedForeground : colors.primaryForeground} />
                <Text style={[styles.testButtonLabel, { color: testNotificationState === 'scheduled' ? colors.mutedForeground : colors.primaryForeground }]}>{testNotificationState === 'scheduled' ? 'In arrivo' : 'Invia'}</Text>
              </Pressable>
            </Surface>
          ) : null}
        </>
      ) : (
        <>
          <View style={[styles.liveBanner, { backgroundColor: colors.primary }]}><View style={[styles.liveDot, { backgroundColor: colors.accent }]} /><View style={{ flex: 1 }}><Text style={[styles.liveKicker, { color: colors.primaryForeground }]}>ADESSO IN CORSO</Text><Text style={[styles.liveTitle, { color: colors.primaryForeground }]}>{nextReminder ? `Prossimo ricordo alle ${timeFromDate(nextReminder.scheduledAt, group.timeZone)}` : 'Tutte le sveglie sono passate'}</Text></View><Feather name="bell" size={22} color={colors.primaryForeground} /></View>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Pronti a ricordare?</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>Quando suona una sveglia hai 15 minuti per scattare. Puoi catturare un ricordo anche in qualsiasi altro momento.</Text>
          <PrimaryButton label="Scatto libero" icon="camera" onPress={() => router.push(`/capture/${id}` as never)} style={{ marginTop: 24 }} />
          <Surface style={styles.albumPreview}><Feather name="image" size={21} color={colors.primary} /><View style={{ flex: 1 }}><Text style={[styles.personName, { color: colors.foreground }]}>Album condiviso</Text><Text style={[styles.personRole, { color: colors.mutedForeground }]}>{group.memories.length} ricordi raccolti finora</Text></View></Surface>
          {group.isOwner ? <Pressable accessibilityRole="button" accessibilityLabel="Chiudi sessione" onPress={closeSession} style={styles.closeSession}><Text style={[styles.closeText, { color: colors.destructive }]}>Chiudi sessione</Text></Pressable> : null}
        </>
      )}

      <Modal visible={Boolean(editing)} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={[styles.modal, { backgroundColor: colors.foreground + '77' }]}><View style={[styles.pickerSheet, { backgroundColor: colors.background }]}><Text style={[styles.pickerTitle, { color: colors.foreground }]}>Scegli l&apos;orario</Text><Text style={[styles.pickerHint, { color: colors.mutedForeground }]}>Tra {group.windowStart} e {group.windowEnd}</Text><View style={[styles.picker, { borderColor: colors.border }]}><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.pickerColumn}>{hours.map((hour) => <Pressable key={hour} onPress={() => setEditing((value) => value ? { ...value, hour } : value)} style={[styles.timeOption, editing?.hour === hour && { backgroundColor: colors.primary }]}><Text style={[styles.timeOptionText, { color: editing?.hour === hour ? colors.primaryForeground : colors.foreground }]}>{String(hour).padStart(2, '0')}</Text></Pressable>)}</ScrollView><Text style={[styles.colon, { color: colors.foreground }]}>:</Text><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.pickerColumn}>{minuteOptions.map((minute) => <Pressable key={minute} onPress={() => setEditing((value) => value ? { ...value, minute } : value)} style={[styles.timeOption, editing?.minute === minute ? { backgroundColor: colors.primary } : undefined]}><Text style={[styles.timeOptionText, { color: editing?.minute === minute ? colors.primaryForeground : colors.foreground }]}>{String(minute).padStart(2, '0')}</Text></Pressable>)}</ScrollView></View><PrimaryButton label="Conferma orario" icon="check" onPress={saveReminder} loading={updateReminder.isPending} /><Pressable onPress={() => setEditing(null)} style={styles.cancel}><Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Annulla</Text></Pressable></View></View>
      </Modal>
    </Screen>
  );
}

function Summary({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  const colors = useColors();
  return <View style={styles.summaryLine}><Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>{label}</Text><Text style={[styles.summaryValue, { color: accent ? colors.primary : colors.foreground }]}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  people: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 5 }, peopleText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  summary: { padding: 17, marginTop: 4, gap: 12 }, summaryLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, summaryLabel: { fontFamily: 'Inter_400Regular', fontSize: 13 }, summaryValue: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 24, lineHeight: 29, letterSpacing: -0.7, marginTop: 28 }, body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, marginTop: 9 },
  listTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, letterSpacing: -0.25, marginTop: 25, marginBottom: 11 }, reminderList: { gap: 9 }, reminder: { minHeight: 67, borderWidth: 1, borderRadius: 17, paddingHorizontal: 17, flexDirection: 'row', alignItems: 'center', gap: 16 }, reminderHour: { fontFamily: 'Inter_700Bold', fontSize: 26, letterSpacing: -0.5, flex: 1 },
  rosterTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, marginTop: 27, marginBottom: 10 }, roster: { gap: 8, marginTop: 20 }, person: { minHeight: 56, paddingVertical: 11, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, personName: { fontFamily: 'Inter_700Bold', fontSize: 15 }, personRole: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  waitNote: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20, paddingHorizontal: 4 }, waitEmoji: { fontSize: 16 }, waitText: { fontFamily: 'Inter_400Regular', fontSize: 14 },
  liveBanner: { marginTop: 20, borderRadius: 22, padding: 17, flexDirection: 'row', alignItems: 'center', gap: 11 }, liveDot: { width: 10, height: 10, borderRadius: 5 }, liveKicker: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.4 }, liveTitle: { fontFamily: 'Inter_700Bold', fontSize: 16, marginTop: 4 }, albumPreview: { marginTop: 20, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 11 }, closeSession: { alignSelf: 'center', paddingHorizontal: 18, paddingVertical: 20 }, closeText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  testCard: { marginTop: 16, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11 }, testIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, testCopy: { flex: 1 }, testTitle: { fontFamily: 'Inter_700Bold', fontSize: 14 }, testBody: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, marginTop: 3 }, testButton: { minWidth: 62, minHeight: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 8 }, testButtonLabel: { fontFamily: 'Inter_700Bold', fontSize: 10 }, pressed: { opacity: 0.8, transform: [{ scale: 0.96 }] },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.6, marginTop: 11 }, title: { fontFamily: 'Inter_700Bold', fontSize: 31, lineHeight: 35, letterSpacing: -1, marginTop: 9 }, album: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 22 }, memory: { width: '48%' }, memoryImage: { aspectRatio: 0.9, borderRadius: 17 }, memoryAuthor: { fontFamily: 'Inter_700Bold', fontSize: 12, marginTop: 6 },
  modal: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 22 }, pickerSheet: { width: '100%', maxWidth: 360, borderRadius: 25, padding: 21 }, pickerTitle: { fontFamily: 'Inter_700Bold', fontSize: 21, textAlign: 'center' }, pickerHint: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', marginTop: 5, marginBottom: 17 }, picker: { height: 216, borderWidth: 1, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 18, overflow: 'hidden' }, pickerColumn: { paddingVertical: 76, alignItems: 'center', gap: 6 }, timeOption: { width: 80, height: 43, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, timeOptionText: { fontFamily: 'Inter_700Bold', fontSize: 21 }, colon: { fontFamily: 'Inter_700Bold', fontSize: 23, marginHorizontal: 5 }, cancel: { alignItems: 'center', paddingTop: 18 }, cancelText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
});