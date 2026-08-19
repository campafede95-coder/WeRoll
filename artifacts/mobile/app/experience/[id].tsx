import React, { useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { getGetExperienceQueryKey, useCloseExperience, useGetExperience, useStartExperience, useUpdateReminder } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Modal, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppHeader, AvatarStack, EmptyState, ErrorState, PrimaryButton, Screen, SkeletonList, Surface, formatDateTime } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function timeFromDate(value: string) {
  return new Date(value).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

export default function GroupSessionScreen() {
  const colors = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const query = useGetExperience(id, { query: { queryKey: getGetExperienceQueryKey(id), enabled: Boolean(id), refetchInterval: 5000 } });
  const start = useStartExperience();
  const close = useCloseExperience();
  const updateReminder = useUpdateReminder();
  const [editing, setEditing] = useState<{ id: string; title: string; time: string } | null>(null);
  const group = query.data;
  const nextReminder = useMemo(() => group?.reminders.find((reminder) => new Date(reminder.scheduledAt).getTime() > Date.now()), [group?.reminders]);

  useEffect(() => {
    if (!group || group.sessionStatus !== 'active') return;
    const schedule = async () => {
      const scheduledKey = `pic-sync-scheduled-${group.id}`;
      if (await AsyncStorage.getItem(scheduledKey)) return;
      const permission = await Notifications.getPermissionsAsync();
      if (!permission.granted) return;
      const identifiers = await Promise.all(group.reminders
        .filter((reminder) => new Date(reminder.scheduledAt).getTime() > Date.now())
        .map((reminder) => Notifications.scheduleNotificationAsync({
          content: {
            title: reminder.title,
            body: 'Hai 15 minuti per scattare questo ricordo.',
            sound: 'default',
            data: { experienceId: group.id },
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(reminder.scheduledAt) },
        })));
      await AsyncStorage.setItem(scheduledKey, JSON.stringify(identifiers));
    };
    void schedule();
  }, [group]);

  const startSession = () => {
    if (!id) return;
    start.mutate({ experienceId: id }, { onSuccess: () => void queryClient.invalidateQueries({ queryKey: getGetExperienceQueryKey(id) }) });
  };
  const closeSession = () => {
    if (!id) return;
    close.mutate({ experienceId: id }, {
      onSuccess: async () => {
        const raw = await AsyncStorage.getItem(`pic-sync-scheduled-${id}`);
        const identifiers: string[] = raw ? JSON.parse(raw) : [];
        await Promise.all(identifiers.map((identifier) => Notifications.cancelScheduledNotificationAsync(identifier)));
        await AsyncStorage.removeItem(`pic-sync-scheduled-${id}`);
        void queryClient.invalidateQueries({ queryKey: getGetExperienceQueryKey(id) });
      },
    });
  };
  const saveReminder = () => {
    if (!id || !editing) return;
    const current = group?.reminders.find((reminder) => reminder.id === editing.id);
    if (!current || !/^\d{2}:\d{2}$/.test(editing.time)) return;
    const date = new Date(current.scheduledAt);
    const [hour, minute] = editing.time.split(':').map(Number);
    date.setHours(hour, minute, 0, 0);
    updateReminder.mutate({ experienceId: id, reminderId: editing.id, data: { title: editing.title, message: 'Hai 15 minuti per scattare questo ricordo.', scheduledAt: date.toISOString() } }, {
      onSuccess: () => { setEditing(null); void queryClient.invalidateQueries({ queryKey: getGetExperienceQueryKey(id) }); },
    });
  };

  if (query.isLoading) return <Screen><AppHeader title="Gruppo" back /><SkeletonList /></Screen>;
  if (query.isError || !group) return <Screen><AppHeader title="Gruppo" back /><ErrorState onRetry={() => void query.refetch()} /></Screen>;

  if (group.sessionStatus === 'closed') {
    return (
      <Screen>
        <AppHeader title="Album finale" back />
        <Text style={[styles.eyebrow, { color: colors.primary }]}>SESSIONE CONCLUSA</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>Tutti i vostri{'\n'}ricordi insieme.</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>{group.memories.length} foto raccolte durante l&apos;avventura.</Text>
        {group.memories.length ? <View style={styles.album}>{group.memories.map((memory) => <View key={memory.id} style={styles.memory}><Image source={{ uri: memory.imageUri }} contentFit="cover" style={styles.memoryImage} /><Text numberOfLines={1} style={[styles.memoryAuthor, { color: colors.foreground }]}>{memory.authorName}</Text></View>)}</View> : <EmptyState icon="image" title="Nessuna foto ancora" body="Le foto scattate verranno raccolte qui." />}
        <PrimaryButton label="Condividi l'album" icon="share-2" onPress={() => void Share.share({ message: `Album Pic Sync · ${group.name} · ${group.memories.length} ricordi raccolti.` })} style={{ marginTop: 22 }} />
      </Screen>
    );
  }

  return (
    <Screen>
      <AppHeader title={group.sessionStatus === 'active' ? 'Sessione attiva' : 'Imposta sveglie'} back action={<View style={styles.people}><Feather name="users" size={18} color={colors.mutedForeground} /><Text style={[styles.peopleText, { color: colors.foreground }]}>{group.participantCount}</Text></View>} />
      <Surface style={styles.summary}>
        <View style={styles.summaryLine}><Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Codice</Text><Text style={[styles.summaryValue, { color: colors.primary }]}>{group.inviteCode}</Text></View>
        <View style={styles.summaryLine}><Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Fascia oraria</Text><Text style={[styles.summaryValue, { color: colors.foreground }]}>{group.windowStart} – {group.windowEnd}</Text></View>
        <View style={styles.summaryLine}><Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Foto totali</Text><Text style={[styles.summaryValue, { color: colors.foreground }]}>{group.targetPhotoCount}</Text></View>
        <View style={styles.summaryLine}><Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Partecipanti</Text><Text style={[styles.summaryValue, { color: colors.foreground }]}>{group.participantCount}</Text></View>
      </Surface>

      {group.sessionStatus === 'lobby' ? (
        <>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Lobby — in attesa{'\n'}dei partecipanti</Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>Condividi il codice. Le {group.reminders.length} sveglie sono già distribuite nella fascia scelta e puoi cambiarle singolarmente.</Text>
          <Surface style={styles.participants}><AvatarStack participants={group.participants} count={group.participantCount} /><Text style={[styles.participantText, { color: colors.foreground }]}>{group.participantCount === 1 ? 'Organizzatore · tu' : `${group.participantCount} partecipanti collegati`}</Text></Surface>
          <Text style={[styles.listTitle, { color: colors.foreground }]}>Sveglie</Text>
          <View style={styles.reminderList}>{group.reminders.map((reminder) => <Pressable key={reminder.id} disabled={!group.isOwner} onPress={() => setEditing({ id: reminder.id, title: reminder.title, time: timeFromDate(reminder.scheduledAt) })} style={[styles.reminder, { borderColor: colors.border, backgroundColor: colors.card }]}><View style={[styles.reminderTime, { backgroundColor: colors.secondary }]}><Text style={[styles.reminderHour, { color: colors.foreground }]}>{timeFromDate(reminder.scheduledAt)}</Text></View><Text style={[styles.reminderTitle, { color: colors.foreground }]}>{reminder.title}</Text>{group.isOwner ? <Feather name="edit-3" size={16} color={colors.primary} /> : null}</Pressable>)}</View>
          {group.isOwner ? <PrimaryButton label="Avvia sessione" icon="play" onPress={startSession} loading={start.isPending} style={{ marginTop: 23 }} /> : <Surface style={styles.waiting}><Feather name="clock" size={20} color={colors.primary} /><Text style={[styles.waitingText, { color: colors.foreground }]}>In attesa che l&apos;organizzatore avvii la sessione.</Text></Surface>}
        </>
      ) : (
        <>
          <View style={[styles.liveBanner, { backgroundColor: colors.primary }]}><View style={[styles.liveDot, { backgroundColor: colors.accent }]} /><View style={{ flex: 1 }}><Text style={[styles.liveKicker, { color: colors.primaryForeground }]}>ADESSO IN CORSO</Text><Text style={[styles.liveTitle, { color: colors.primaryForeground }]}>{nextReminder ? `Prossimo ricordo alle ${timeFromDate(nextReminder.scheduledAt)}` : 'Tutte le sveglie sono passate'}</Text></View><Feather name="bell" size={22} color={colors.primaryForeground} /></View>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Pronti a ricordare?</Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>Quando suona una sveglia hai 15 minuti per scattare. Puoi catturare un ricordo anche in qualsiasi altro momento.</Text>
          <PrimaryButton label="Scatto libero" icon="camera" onPress={() => router.push(`/capture/${id}` as never)} style={{ marginTop: 24 }} />
          <Surface style={styles.albumPreview}><Feather name="image" size={21} color={colors.primary} /><View style={{ flex: 1 }}><Text style={[styles.participantText, { color: colors.foreground }]}>Album condiviso</Text><Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>{group.memories.length} ricordi raccolti finora</Text></View><Feather name="chevron-right" size={18} color={colors.mutedForeground} /></Surface>
          {group.isOwner ? <Pressable accessibilityRole="button" accessibilityLabel="Chiudi sessione" onPress={closeSession} style={styles.closeSession}><Text style={[styles.closeText, { color: colors.destructive }]}>Chiudi sessione</Text></Pressable> : null}
        </>
      )}
      <Modal visible={Boolean(editing)} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={[styles.modal, { backgroundColor: colors.foreground + '77' }]}><View style={[styles.editSheet, { backgroundColor: colors.background }]}><Text style={[styles.listTitle, { color: colors.foreground }]}>Modifica sveglia</Text><TextInput value={editing?.title ?? ''} onChangeText={(title) => setEditing((value) => value ? { ...value, title } : value)} placeholder="Titolo" placeholderTextColor={colors.mutedForeground} style={[styles.editInput, { backgroundColor: colors.card, borderColor: colors.input, color: colors.foreground }]} /><TextInput value={editing?.time ?? ''} onChangeText={(time) => setEditing((value) => value ? { ...value, time } : value)} keyboardType="numbers-and-punctuation" maxLength={5} placeholder="09:00" placeholderTextColor={colors.mutedForeground} style={[styles.editInput, { backgroundColor: colors.card, borderColor: colors.input, color: colors.foreground }]} /><PrimaryButton label="Salva sveglia" icon="check" onPress={saveReminder} loading={updateReminder.isPending} /><Pressable onPress={() => setEditing(null)} style={styles.cancel}><Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Annulla</Text></Pressable></View></View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  people: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 5 },
  peopleText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  summary: { padding: 17, marginTop: 4, gap: 12 },
  summaryLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  summaryValue: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 24, lineHeight: 29, letterSpacing: -0.7, marginTop: 28 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, marginTop: 9 },
  participants: { marginTop: 20, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  participantText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  listTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, letterSpacing: -0.25, marginTop: 25, marginBottom: 11 },
  reminderList: { gap: 8 },
  reminder: { minHeight: 59, borderWidth: 1, borderRadius: 17, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 11 },
  reminderTime: { height: 37, minWidth: 58, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
  reminderHour: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  reminderTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14, flex: 1 },
  waiting: { marginTop: 23, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 15 },
  waitingText: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 19, flex: 1 },
  liveBanner: { marginTop: 20, borderRadius: 22, padding: 17, flexDirection: 'row', alignItems: 'center', gap: 11 },
  liveDot: { width: 10, height: 10, borderRadius: 5 },
  liveKicker: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.4 },
  liveTitle: { fontFamily: 'Inter_700Bold', fontSize: 16, marginTop: 4 },
  albumPreview: { marginTop: 20, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 11 },
  closeSession: { alignSelf: 'center', paddingHorizontal: 18, paddingVertical: 20 },
  closeText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.6, marginTop: 11 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 31, lineHeight: 35, letterSpacing: -1, marginTop: 9 },
  album: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 22 },
  memory: { width: '48%' },
  memoryImage: { aspectRatio: 0.9, borderRadius: 17 },
  memoryAuthor: { fontFamily: 'Inter_700Bold', fontSize: 12, marginTop: 6 },
  modal: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 22 },
  editSheet: { width: '100%', borderRadius: 25, padding: 21 },
  editInput: { height: 54, borderWidth: 1, borderRadius: 15, paddingHorizontal: 15, fontFamily: 'Inter_500Medium', fontSize: 15, marginBottom: 11 },
  cancel: { alignItems: 'center', paddingTop: 18 },
  cancelText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
});