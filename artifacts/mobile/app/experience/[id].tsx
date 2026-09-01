import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { zipSync } from 'fflate';
import { getGetExperienceQueryKey, useCloseExperience, useGetExperience, useRegisterPushToken, useSendTestPush, useStartExperience, useUpdateReminder } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppHeader, EmptyState, ErrorState, PrimaryButton, Screen, SkeletonList, Surface } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';
import { LAST_EXPERIENCE_ID_STORAGE_KEY, rememberClosedExperience, resolveExperienceId } from '@/constants/experience';
import { ensurePhotoReminderChannel } from '@/constants/notifications';
import { pickerOffsetForIndex } from '@/constants/timePicker';

const PHOTO_WINDOW_MS = 15 * 60 * 1000;

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

function formatCountdown(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function toMinutes(time?: string | null) {
  if (!time) return 0;
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

type EditingReminder = { id: string; hour: number; minute: number } | null;
type AlbumMemory = { id: string; imageUri: string; authorName: string; capturedAt: string };
type TestPushStatus = { tone: 'success' | 'error'; message: string } | null;

const BASE64_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function sanitizeFilePart(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'foto';
}

function decodeBase64(base64: string) {
  const source = base64.replace(/[\r\n\s]/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = source.endsWith('==') ? 2 : source.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array(Math.floor((source.length * 3) / 4) - padding);
  let buffer = 0;
  let bits = 0;
  let offset = 0;

  for (const character of source) {
    if (character === '=') break;
    const value = BASE64_CHARACTERS.indexOf(character);
    if (value < 0) throw new Error('Immagine in un formato non supportato.');
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[offset] = (buffer >> bits) & 0xff;
      offset += 1;
      buffer &= (1 << bits) - 1;
    }
  }
  return bytes;
}

async function imageFileForArchive(memory: AlbumMemory, index: number) {
  const dataUri = /^data:image\/([a-z0-9.+-]+);base64,(.+)$/i.exec(memory.imageUri);
  let bytes: Uint8Array;
  let extension = 'jpg';

  if (dataUri) {
    const subtype = dataUri[1].toLowerCase();
    extension = subtype === 'jpeg' ? 'jpg' : subtype === 'svg+xml' ? 'svg' : subtype;
    bytes = decodeBase64(dataUri[2]);
  } else {
    const response = await fetch(memory.imageUri);
    if (!response.ok) throw new Error('Una foto non è più disponibile.');
    bytes = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get('content-type')?.split(';')[0].replace('image/', '');
    extension = contentType === 'jpeg' ? 'jpg' : contentType || extension;
  }

  const author = sanitizeFilePart(memory.authorName);
  return [`${String(index + 1).padStart(2, '0')}-${author}-${memory.id.slice(-6)}.${extension}`, bytes] as const;
}

export default function GroupSessionScreen() {
  const colors = useColors();
  const router = useRouter();
  const hourPickerRef = useRef<ScrollView>(null);
  const minutePickerRef = useRef<ScrollView>(null);
  const { id, experienceId: experienceIdParam, momentReminderId, momentScheduledAt } = useLocalSearchParams<{ id: string; experienceId?: string; momentReminderId?: string; momentScheduledAt?: string }>();
  const experienceId = resolveExperienceId(experienceIdParam, id);
  const queryClient = useQueryClient();
  const query = useGetExperience(experienceId, { query: { queryKey: getGetExperienceQueryKey(experienceId), enabled: Boolean(experienceId), refetchInterval: 5000 } });
  const start = useStartExperience();
  const close = useCloseExperience();
  const updateReminder = useUpdateReminder();
  const registerPushToken = useRegisterPushToken();
  const testPush = useSendTestPush();
  const [editing, setEditing] = useState<EditingReminder>(null);
  const [testPushStatus, setTestPushStatus] = useState<TestPushStatus>(null);
  const [isExportingAlbum, setIsExportingAlbum] = useState(false);
  const [now, setNow] = useState(Date.now());
  const group = query.data;
  const derivedMoment = useMemo(() => {
    if (!group || group.sessionStatus !== 'active') return null;
    return group.reminders
      .filter((reminder) => {
        const start = new Date(reminder.scheduledAt).getTime();
        return start <= now && now < start + PHOTO_WINDOW_MS;
      })
      .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())[0] ?? null;
  }, [group, now]);
  const routeMomentStart = momentScheduledAt ? new Date(momentScheduledAt).getTime() : 0;
  const routeMomentIsActive = Number.isFinite(routeMomentStart) && routeMomentStart <= now && routeMomentStart + PHOTO_WINDOW_MS > now;
  const activeMomentReminderId = routeMomentIsActive ? momentReminderId : derivedMoment?.id;
  const activeMomentScheduledAt = routeMomentIsActive ? momentScheduledAt : derivedMoment?.scheduledAt;
  const momentEndTime = activeMomentScheduledAt ? new Date(activeMomentScheduledAt).getTime() + PHOTO_WINDOW_MS : 0;
  const momentRemaining = momentEndTime > 0 ? Math.max(0, momentEndTime - now) : 0;
  const hasActiveMoment = Boolean(activeMomentScheduledAt) && momentRemaining > 0;
  const autoOpenedMomentRef = useRef<string | null>(null);

  useEffect(() => {
    if (experienceId) void AsyncStorage.setItem(LAST_EXPERIENCE_ID_STORAGE_KEY, experienceId);
  }, [experienceId]);

  useEffect(() => {
    if (group?.sessionStatus !== 'active') return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [group?.sessionStatus]);

  useEffect(() => {
    if (!group || group.sessionStatus !== 'active' || !derivedMoment || routeMomentIsActive) return;
    if (autoOpenedMomentRef.current === derivedMoment.id) return;
    autoOpenedMomentRef.current = derivedMoment.id;
    router.push({
      pathname: '/moment/[id]',
      params: {
        id: group.id,
        experienceId: group.id,
        reminderId: derivedMoment.id,
        scheduledAt: derivedMoment.scheduledAt,
        source: 'session',
      },
    });
  }, [derivedMoment, group, routeMomentIsActive, router]);

  useEffect(() => {
    console.log('[PUSH DEBUG] effect run group.id =', group?.id ?? null, 'platform =', Platform.OS);
    if (!group || (Platform.OS !== 'ios' && Platform.OS !== 'android')) {
      console.log('[PUSH DEBUG] effect skipped: missing group or unsupported platform');
      return;
    }
    let cancelled = false;

    const registerThisDevice = async () => {
      let phase = 'start';
      try {
        console.log('[PUSH DEBUG] registerThisDevice start');
        console.log('[PUSH DEBUG] group.id =', group.id);
        phase = 'ensurePhotoReminderChannel';
        console.log('[PUSH DEBUG] before ensurePhotoReminderChannel');
        await ensurePhotoReminderChannel();
        console.log('[PUSH DEBUG] after ensurePhotoReminderChannel');

        phase = 'getPermissionsAsync';
        console.log('[PUSH DEBUG] before getPermissionsAsync');
        const currentPermission = await Notifications.getPermissionsAsync();
        console.log('[PUSH DEBUG] after getPermissionsAsync granted =', currentPermission.granted);
        let permission = currentPermission;
        if (!currentPermission.granted) {
          phase = 'requestPermissionsAsync';
          console.log('[PUSH DEBUG] before requestPermissionsAsync');
          permission = await Notifications.requestPermissionsAsync();
          console.log('[PUSH DEBUG] after requestPermissionsAsync granted =', permission.granted);
        }
        if (!permission.granted) {
          console.log('[PUSH DEBUG] registration stopped: notification permission not granted');
          return;
        }

        const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
        console.log('[PUSH DEBUG] projectId =', projectId ?? null);
        if (!projectId) {
          console.warn('Le notifiche remote richiedono un Expo/EAS Project ID configurato.');
          return;
        }

        phase = 'getExpoPushTokenAsync';
        console.log('[PUSH DEBUG] before getExpoPushTokenAsync');
        const token = await Notifications.getExpoPushTokenAsync({ projectId });
        console.log('[PUSH DEBUG] after getExpoPushTokenAsync');
        console.log('[PUSH DEBUG] token obtained =', Boolean(token.data));
        if (cancelled || !token.data) {
          console.log('[PUSH DEBUG] registration stopped: cancelled =', cancelled, 'token obtained =', Boolean(token.data));
          return;
        }
        console.log('[PUSH DEBUG] before POST push-token');
        registerPushToken.mutate({
          experienceId: group.id,
          data: { token: token.data, platform: Platform.OS === 'ios' ? 'ios' : 'android' },
        }, {
          onSuccess: () => console.log('[PUSH DEBUG] POST push-token response = success'),
          onError: (error) => console.warn('[PUSH DEBUG] POST push-token response = error', error),
        });
      } catch (error) {
        console.warn('[PUSH DEBUG] error during', phase, error);
        console.warn('Non è stato possibile registrare questo telefono per gli avvisi del gruppo.', error);
      }
    };

    void registerThisDevice();
    const tokenSubscription = Notifications.addPushTokenListener(() => void registerThisDevice());
    return () => {
      cancelled = true;
      tokenSubscription.remove();
    };
  }, [group?.id]);

  useEffect(() => {
    if (!group || (group.sessionStatus !== 'active' && group.sessionStatus !== 'closed') || (Platform.OS !== 'ios' && Platform.OS !== 'android')) return;
    const cancelLegacyLocalReminders = async () => {
      try {
        const scheduled = await Notifications.getAllScheduledNotificationsAsync();
        await Promise.all(scheduled
          .filter((notification) =>
            notification.content.data?.experienceId === group.id &&
            (group.sessionStatus === 'closed' || (
              notification.content.data?.test !== true &&
              notification.content.data?.test !== 'true'
            )))
          .map((notification) => Notifications.cancelScheduledNotificationAsync(notification.identifier)));
        if (group.sessionStatus === 'closed') {
          await AsyncStorage.removeItem('pic-sync-active-moment');
          await rememberClosedExperience(group.id);
        }
      } catch (error) {
        console.warn('Non è stato possibile rimuovere una vecchia sveglia locale del gruppo.', error);
      }
    };
    void cancelLegacyLocalReminders();
  }, [group?.id, group?.sessionStatus]);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: getGetExperienceQueryKey(experienceId) });
  const sendTestNotification = () => {
    if (!experienceId || testPush.isPending) return;
    setTestPushStatus(null);
    testPush.mutate({ experienceId }, {
      onSuccess: ({ sent, attempted }) => {
        setTestPushStatus({
          tone: 'success',
          message: `${sent} di ${attempted} notifiche accettate per l’invio.`,
        });
      },
      onError: (error) => {
        const status = typeof error === 'object' && error && 'status' in error ? error.status : undefined;
        setTestPushStatus({
          tone: 'error',
          message: status === 409
            ? 'Nessun token push registrato. Apri questa sessione sul telefono, consenti le notifiche e riprova.'
            : 'Notifica non inviata. Verifica la connessione e riprova.',
        });
      },
    });
  };
  const startSession = () => { if (experienceId) start.mutate({ experienceId }, { onSuccess: refresh }); };
  const closeSession = () => {
    if (!experienceId) return;
    const closeAfterLocalCancellation = async () => {
      if (Platform.OS === 'ios' || Platform.OS === 'android') try {
        const scheduled = await Notifications.getAllScheduledNotificationsAsync();
        const sessionNotifications = scheduled.filter((notification) => notification.content.data?.experienceId === experienceId);
        await Promise.allSettled(sessionNotifications.map((notification) => Notifications.cancelScheduledNotificationAsync(notification.identifier)));
      } catch (error) {
        console.warn('Non è stato possibile rimuovere tutte le sveglie locali della sessione.', error);
      }
      await AsyncStorage.removeItem('pic-sync-active-moment');
      close.mutate({ experienceId }, {
        onSuccess: () => {
          void rememberClosedExperience(experienceId);
          refresh();
        },
      });
    };
    void closeAfterLocalCancellation();
  };
  const saveReminder = () => {
    if (!group || !editing || !experienceId) return;
    const reminder = group.reminders.find((item) => item.id === editing.id);
    if (!reminder) return;
    updateReminder.mutate({
      experienceId,
      reminderId: reminder.id,
      data: { title: reminder.title, message: reminder.message, scheduledAt: dateAtGroupTime(reminder.scheduledAt, editing.hour, editing.minute, group.timeZone).toISOString() },
    }, { onSuccess: () => { setEditing(null); refresh(); } });
  };
  const exportAlbum = async () => {
    if (!group?.memories.length || isExportingAlbum) return;
    if (Platform.OS === 'web') {
      Alert.alert('Disponibile sul telefono', 'Apri l’album finale su iPhone o Android per salvare il file ZIP.');
      return;
    }

    setIsExportingAlbum(true);
    try {
      const imageFiles = await Promise.all(group.memories.map(imageFileForArchive));
      const archive = zipSync(Object.fromEntries(imageFiles), { level: 0 });
      const archiveFile = new File(Paths.cache, `album-${sanitizeFilePart(group.name)}.zip`);
      archiveFile.write(archive);

      if (!await Sharing.isAvailableAsync()) {
        Alert.alert('Condivisione non disponibile', 'Questo telefono non può aprire la finestra per salvare il file ZIP.');
        return;
      }

      await Sharing.shareAsync(archiveFile.uri, {
        mimeType: 'application/zip',
        dialogTitle: `Salva l’album ${group.name}`,
        UTI: 'public.zip-archive',
      });
    } catch (error) {
      console.warn('Esportazione album fallita.', error);
      Alert.alert('ZIP non creato', 'Non siamo riusciti a preparare tutte le foto. Riprova tra un momento.');
    } finally {
      setIsExportingAlbum(false);
    }
  };

  const hours = useMemo(() => {
    if (!group) return [];
    return Array.from({ length: Math.floor(toMinutes(group.windowEnd) / 60) - Math.floor(toMinutes(group.windowStart) / 60) + 1 }, (_, index) => Math.floor(toMinutes(group.windowStart) / 60) + index);
  }, [group?.windowEnd, group?.windowStart]);
  const minuteOptions = useMemo(() => {
    if (!group || !editing) return [];
    return Array.from({ length: 60 }, (_, index) => index).filter((minute) => {
      const value = editing.hour * 60 + minute;
      return value >= toMinutes(group.windowStart) && value <= toMinutes(group.windowEnd);
    });
  }, [editing, group?.windowEnd, group?.windowStart]);
  const waitingRoom = group?.sessionStatus === 'lobby' && !group.isOwner;
  const scrollToEditingTime = (selection: EditingReminder | null) => {
    if (!selection) return;
    const hourIndex = Math.max(0, hours.indexOf(selection.hour));
    const minuteIndex = Math.max(0, minuteOptions.indexOf(selection.minute));
    hourPickerRef.current?.scrollTo({ y: pickerOffsetForIndex(hourIndex), animated: false });
    minutePickerRef.current?.scrollTo({ y: pickerOffsetForIndex(minuteIndex), animated: false });
  };

  useEffect(() => {
    if (!editing) return;
    const frame = requestAnimationFrame(() => scrollToEditingTime(editing));
    return () => cancelAnimationFrame(frame);
  }, [editing, hours, minuteOptions]);

  if (query.isLoading) return <Screen><AppHeader title="Gruppo" back /><SkeletonList /></Screen>;
  if (query.isError || !group) return <Screen><AppHeader title="Gruppo" back /><ErrorState onRetry={() => void query.refetch()} /></Screen>;

  if (group.sessionStatus === 'closed') {
    return <Screen><AppHeader title="Album finale" back /><Text style={[styles.eyebrow, { color: colors.primary }]}>SESSIONE CONCLUSA</Text><Text style={[styles.title, { color: colors.foreground }]}>Tutti i vostri{'\n'}ricordi insieme.</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>{group.memories.length} foto raccolte durante l&apos;avventura.</Text>{group.memories.length ? <View style={styles.album}>{group.memories.map((memory) => <View key={memory.id} style={styles.memory}><Image source={{ uri: memory.imageUri }} contentFit="cover" style={styles.memoryImage} /><Text numberOfLines={1} style={[styles.memoryAuthor, { color: colors.foreground }]}>{memory.authorName}</Text></View>)}</View> : <EmptyState icon="image" title="Nessuna foto ancora" body="Le foto scattate verranno raccolte qui." />}{group.memories.length ? <><PrimaryButton label="Scarica album ZIP" icon="download" onPress={() => void exportAlbum()} loading={isExportingAlbum} style={{ marginTop: 22 }} /><Text style={[styles.zipHint, { color: colors.mutedForeground }]}>Scegli “Salva su File” per conservare tutte le foto in un unico ZIP.</Text></> : null}</Screen>;
  }

  return (
    <Screen>
       <AppHeader title={waitingRoom ? 'In attesa' : group.sessionStatus === 'active' ? 'Sessione attiva' : 'I tuoi momenti'} back action={<View style={styles.people}><Feather name="users" size={18} color={colors.mutedForeground} /><Text style={[styles.peopleText, { color: colors.foreground }]}>{group.participantCount}</Text></View>} />
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
           <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Personalizza gli orari</Text>
           <Text style={[styles.body, { color: colors.mutedForeground }]}>Tocca un orario se vuoi modificarlo. Tutti gli scatti rimarranno all&apos;interno della fascia {group.windowStart} – {group.windowEnd}.</Text>
           <Text style={[styles.listTitle, { color: colors.foreground }]}>Timeline dei ricordi</Text>
          <View style={styles.reminderList}>{group.reminders.map((reminder) => <Pressable key={reminder.id} accessibilityRole="button" accessibilityLabel={`Modifica sveglia delle ${timeFromDate(reminder.scheduledAt, group.timeZone)}`} onPress={() => { const current = partsFor(new Date(reminder.scheduledAt), group.timeZone); setEditing({ id: reminder.id, hour: current.hour, minute: current.minute }); }} style={[styles.reminder, { borderColor: colors.border, backgroundColor: colors.card }]}><Feather name="clock" size={23} color={colors.primary} /><Text style={[styles.reminderHour, { color: colors.foreground }]}>{timeFromDate(reminder.scheduledAt, group.timeZone)}</Text><Feather name="chevron-right" size={18} color={colors.mutedForeground} /></Pressable>)}</View>
          <Text style={[styles.rosterTitle, { color: colors.foreground }]}>Partecipanti ({group.participantCount})</Text>
          <View style={styles.roster}>{group.participants.map((participant) => <Surface key={participant.id} style={styles.person}><Text style={[styles.personName, { color: colors.foreground }]}>{participant.displayName}{participant.isOrganizer ? ' ✨' : ''}</Text><Text style={[styles.personRole, { color: colors.mutedForeground }]}>{participant.isOrganizer ? 'Organizzatore' : 'Nel gruppo'}</Text></Surface>)}</View>
          <PrimaryButton label="Avvia sessione" icon="play" onPress={startSession} loading={start.isPending} style={{ marginTop: 24 }} />
        </>
      ) : (
        <>
          {hasActiveMoment ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Riapri il countdown"
              testID="active-moment-banner"
              onPress={() => router.push({
                pathname: '/moment/[id]',
        params: { id: group.id, experienceId: group.id, reminderId: activeMomentReminderId, scheduledAt: activeMomentScheduledAt, source: 'session' },
              })}
              style={[styles.momentBanner, { backgroundColor: colors.secondary }]}
            >
              <View style={[styles.momentIcon, { backgroundColor: colors.primary }]}><Feather name="camera" size={16} color={colors.primaryForeground} /></View>
              <View style={styles.momentCopy}><Text style={[styles.momentKicker, { color: colors.primary }]}>RICORDO IN CORSO</Text><Text style={[styles.momentTitle, { color: colors.foreground }]}>Tempo rimasto</Text></View>
              <Text testID="active-moment-countdown" style={[styles.momentCountdown, { color: colors.primary }]}>{formatCountdown(momentRemaining)}</Text>
              <Feather name="chevron-right" size={19} color={colors.primary} />
            </Pressable>
          ) : null}
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Pronti a ricordare?</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>Ad ogni notifica hai 15 minuti per catturare il tuo ricordo.{'\n\n'}Ma niente pressione se non riesci: goditi il momento e scatta quando vuoi!</Text>
          <Surface style={styles.testPushCard}>
            <View style={styles.testPushCopy}>
              <Text style={[styles.personName, { color: colors.foreground }]}>Test notifiche</Text>
              <Text style={[styles.personRole, { color: colors.mutedForeground }]}>Invia una push a questo telefono per verificare permessi, suono e canale.</Text>
            </View>
            <PrimaryButton label="Invia test" icon="bell" variant="soft" onPress={sendTestNotification} loading={testPush.isPending} />
            {testPushStatus ? (
              <Text
                accessibilityLiveRegion="polite"
                style={[styles.testPushStatus, { color: testPushStatus.tone === 'success' ? colors.primary : colors.destructive }]}
              >
                {testPushStatus.message}
              </Text>
            ) : null}
          </Surface>
          <PrimaryButton
            label="Scatto libero"
            icon="camera"
            onPress={() => router.push({
              pathname: '/capture/[id]',
              params: { id: group.id, experienceId: group.id, autoCamera: 'true' },
            })}
            style={{ marginTop: 24 }}
          />
          <Surface style={styles.albumPreview}><Feather name="image" size={21} color={colors.primary} /><View style={{ flex: 1 }}><Text style={[styles.personName, { color: colors.foreground }]}>Album condiviso</Text><Text style={[styles.personRole, { color: colors.mutedForeground }]}>{group.memories.length} ricordi raccolti finora</Text></View></Surface>
          {group.isOwner ? <Pressable accessibilityRole="button" accessibilityLabel="Chiudi sessione" onPress={closeSession} style={styles.closeSession}><Text style={[styles.closeText, { color: colors.destructive }]}>Chiudi sessione</Text></Pressable> : null}
        </>
      )}

      <Modal visible={Boolean(editing)} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={[styles.modal, { backgroundColor: colors.foreground + '77' }]}><View style={[styles.pickerSheet, { backgroundColor: colors.background }]}><Text style={[styles.pickerTitle, { color: colors.foreground }]}>Scegli l&apos;orario</Text><Text style={[styles.pickerHint, { color: colors.mutedForeground }]}>Tra {group.windowStart} e {group.windowEnd}</Text><View style={[styles.picker, { borderColor: colors.border }]}><ScrollView ref={hourPickerRef} style={styles.pickerColumnScroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.pickerColumn} onContentSizeChange={() => scrollToEditingTime(editing)}>{hours.map((hour) => <Pressable key={hour} testID={`time-hour-${String(hour).padStart(2, '0')}`} onPress={() => setEditing((value) => value ? { ...value, hour } : value)} style={[styles.timeOption, editing?.hour === hour && { backgroundColor: colors.primary }]}><Text style={[styles.timeOptionText, { color: editing?.hour === hour ? colors.primaryForeground : colors.foreground }]}>{String(hour).padStart(2, '0')}</Text></Pressable>)}</ScrollView><Text style={[styles.colon, { color: colors.foreground }]}>:</Text><ScrollView ref={minutePickerRef} style={styles.pickerColumnScroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.pickerColumn} onContentSizeChange={() => scrollToEditingTime(editing)}>{minuteOptions.map((minute) => <Pressable key={minute} testID={`time-minute-${String(minute).padStart(2, '0')}`} onPress={() => setEditing((value) => value ? { ...value, minute } : value)} style={[styles.timeOption, editing?.minute === minute ? { backgroundColor: colors.primary } : undefined]}><Text style={[styles.timeOptionText, { color: editing?.minute === minute ? colors.primaryForeground : colors.foreground }]}>{String(minute).padStart(2, '0')}</Text></Pressable>)}</ScrollView></View><PrimaryButton label="Conferma orario" icon="check" onPress={saveReminder} loading={updateReminder.isPending} /><Pressable onPress={() => setEditing(null)} style={styles.cancel}><Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Annulla</Text></Pressable></View></View>
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
  momentBanner: { marginTop: 20, minHeight: 70, borderRadius: 19, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, momentIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, momentCopy: { flex: 1 }, momentKicker: { fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 1.2 }, momentTitle: { fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 3 }, momentCountdown: { fontFamily: 'Inter_700Bold', fontSize: 18, fontVariant: ['tabular-nums'] }, testPushCard: { marginTop: 20, padding: 14, gap: 13 }, testPushCopy: { gap: 4 }, testPushStatus: { fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 17, textAlign: 'center' }, albumPreview: { marginTop: 20, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 11 }, closeSession: { alignSelf: 'center', paddingHorizontal: 18, paddingVertical: 20 }, closeText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.96 }] },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.6, marginTop: 11 }, title: { fontFamily: 'Inter_700Bold', fontSize: 31, lineHeight: 35, letterSpacing: -1, marginTop: 9 }, album: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 22 }, memory: { width: '48%' }, memoryImage: { aspectRatio: 0.9, borderRadius: 17 }, memoryAuthor: { fontFamily: 'Inter_700Bold', fontSize: 12, marginTop: 6 }, zipHint: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 10, paddingHorizontal: 14 },
  modal: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 22 }, pickerSheet: { width: '100%', maxWidth: 360, borderRadius: 25, padding: 21 }, pickerTitle: { fontFamily: 'Inter_700Bold', fontSize: 21, textAlign: 'center' }, pickerHint: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', marginTop: 5, marginBottom: 17 }, picker: { height: 216, borderWidth: 1, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 18, overflow: 'hidden' }, pickerColumnScroll: { flex: 1, alignSelf: 'stretch' }, pickerColumn: { paddingVertical: 76, alignItems: 'center', gap: 6 }, timeOption: { width: 80, height: 43, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, timeOptionText: { fontFamily: 'Inter_700Bold', fontSize: 21 }, colon: { fontFamily: 'Inter_700Bold', fontSize: 23, marginHorizontal: 5 }, cancel: { alignItems: 'center', paddingTop: 18 }, cancelText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
});
