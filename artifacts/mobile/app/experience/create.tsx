import React, { useEffect, useRef, useState } from 'react';
import { ApiError, ResponseParseError, useCreateExperience } from '@workspace/api-client-react';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Modal, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { AppHeader, PrimaryButton, Surface } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';
import { pickerOffsetForIndex } from '@/constants/timePicker';

const options = [6, 12, 18, 24, 30, 36];

function todayAt(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  const date = new Date();
  date.setHours(hours || 0, minutes || 0, 0, 0);
  return date;
}

function timeParts(value: string) {
  const [hour, minute] = value.split(':').map(Number);
  return { hour: Number.isFinite(hour) ? hour : 0, minute: Number.isFinite(minute) ? minute : 0 };
}

function formatTime(hour: number, minute: number) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function createGroupErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    console.error('Create experience request failed', {
      method: error.method,
      url: error.url,
      status: error.status,
      response: error.data,
    });
    return `Il server ha risposto con errore (${error.status}). Riprova tra un momento.`;
  }
  if (error instanceof ResponseParseError) {
    console.error('Create experience response could not be parsed', {
      method: error.method,
      url: error.url,
      status: error.status,
      rawBody: error.rawBody,
    });
    return 'Il server ha restituito una risposta non valida. Riprova tra un momento.';
  }
  console.error('Create experience network error', error);
  return 'Controlla la connessione e riprova tra un momento.';
}

export default function CreateGroupScreen() {
  const colors = useColors();
  const router = useRouter();
  const hourPickerRef = useRef<ScrollView>(null);
  const minutePickerRef = useRef<ScrollView>(null);
  const createGroup = useCreateExperience();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [organizerName, setOrganizerName] = useState('');
  const [photoCount, setPhotoCount] = useState(12);
  const [windowStart, setWindowStart] = useState('09:00');
  const [windowEnd, setWindowEnd] = useState('18:00');
  const [created, setCreated] = useState<{ id: string; inviteCode: string } | null>(null);
  const [timePicker, setTimePicker] = useState<{ field: 'start' | 'end'; hour: number; minute: number } | null>(null);
  const scrollToTime = (selection: typeof timePicker) => {
    if (!selection) return;
    hourPickerRef.current?.scrollTo({ y: pickerOffsetForIndex(selection.hour), animated: false });
    minutePickerRef.current?.scrollTo({ y: pickerOffsetForIndex(selection.minute), animated: false });
  };

  useEffect(() => {
    if (!timePicker) return;
    const frame = requestAnimationFrame(() => scrollToTime(timePicker));
    return () => cancelAnimationFrame(frame);
  }, [timePicker]);

  const submit = async () => {
    if (!/^\d{2}:\d{2}$/.test(windowStart) || !/^\d{2}:\d{2}$/.test(windowEnd) || todayAt(windowEnd) <= todayAt(windowStart)) {
      Alert.alert('Controlla gli orari', 'Inserisci una fascia valida, ad esempio dalle 09:00 alle 18:00.');
      return;
    }
    await AsyncStorage.setItem('pic-sync-guest-name', organizerName.trim());
    createGroup.mutate({
      data: {
        name: 'La nostra avventura',
        startDate: todayAt(windowStart).toISOString(),
        endDate: todayAt(windowEnd).toISOString(),
        targetPhotoCount: photoCount,
        windowStart,
        windowEnd,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Rome',
      },
    }, {
      onSuccess: (group) => {
        setCreated({ id: group.id, inviteCode: group.inviteCode });
        setStep(4);
      },
      onError: (error: unknown) => Alert.alert('Non riusciamo a creare il gruppo', createGroupErrorMessage(error)),
    });
  };

  const shareInvite = async () => {
    if (!created) return;
    const message = `Partecipa al mio gruppo WeRoll!\nCodice: ${created.inviteCode}`;
    try {
      await Share.share({ message, title: 'Invita al gruppo WeRoll' });
    } catch (error) {
      console.warn('Condivisione invito fallita.', error);
      Alert.alert('Condivisione non disponibile', 'Non è stato possibile aprire il menu di condivisione.');
    }
  };

  if (step === 4 && created) {
    return (
      <View style={[styles.successPage, { backgroundColor: colors.background }]}>
        <AppHeader title="Gruppo creato" back />
        <View style={styles.successContent}>
          <View style={[styles.successIcon, { backgroundColor: colors.secondary }]}><Feather name="check" size={44} color={colors.primary} /></View>
          <Text style={[styles.successTitle, { color: colors.foreground }]}>Gruppo creato!</Text>
          <Text style={[styles.successBody, { color: colors.mutedForeground }]}>Condividi il codice con i partecipanti. Entreranno senza creare un account.</Text>
          <View style={[styles.codeCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Text style={[styles.code, { color: colors.foreground }]}>{created.inviteCode}</Text>
          </View>
          <View style={styles.inviteActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copia il codice"
              testID="copy-invite-code"
              onPress={() => void Clipboard.setStringAsync(created.inviteCode)}
              style={({ pressed }) => [styles.inviteAction, { borderColor: colors.border, backgroundColor: colors.card }, pressed && styles.pressed]}
            >
              <Feather name="copy" size={19} color={colors.primary} />
              <Text style={[styles.inviteActionLabel, { color: colors.foreground }]}>Copia</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Condividi il codice"
              testID="share-invite-code"
              onPress={() => void shareInvite()}
              style={({ pressed }) => [styles.inviteAction, { borderColor: colors.primary, backgroundColor: colors.primary }, pressed && styles.pressed]}
            >
              <Feather name="share-2" size={19} color={colors.primaryForeground} />
              <Text style={[styles.inviteActionLabel, { color: colors.primaryForeground }]}>Condividi</Text>
            </Pressable>
          </View>
          <Surface style={styles.participantCard}><Feather name="users" size={19} color={colors.primary} /><View><Text style={[styles.participantTitle, { color: colors.foreground }]}>Partecipanti collegati (1)</Text><Text style={[styles.participantBody, { color: colors.mutedForeground }]}>Organizzatore · tu</Text></View></Surface>
        </View>
        <PrimaryButton label="Vai alla sessione" icon="arrow-right" onPress={() => router.replace({ pathname: '/experience/[id]', params: { id: created.id, experienceId: created.id } })} style={styles.bottomButton} />
      </View>
    );
  }

  return (
    <KeyboardAwareScrollViewCompat contentContainerStyle={[styles.page, { backgroundColor: colors.background }]}>
      <AppHeader title="Crea un gruppo" back />
      {step === 1 ? (
        <>
          <View style={styles.intro}><View style={[styles.introIcon, { backgroundColor: colors.secondary }]}><Feather name="user" size={22} color={colors.primary} /></View><Text style={[styles.heading, { color: colors.foreground }]}>Come ti chiami?</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>Comparirai come organizzatore del gruppo.</Text></View>
          <TextInput value={organizerName} onChangeText={setOrganizerName} autoCapitalize="words" maxLength={40} placeholder="Il tuo nome" placeholderTextColor={colors.mutedForeground} style={[styles.nameInput, { backgroundColor: colors.card, borderColor: colors.input, color: colors.foreground }]} />
          <PrimaryButton label="Avanti" icon="arrow-right" onPress={() => setStep(2)} disabled={!organizerName.trim()} style={styles.actionButton} />
        </>
      ) : step === 2 ? (
        <>
          <View style={styles.intro}><View style={[styles.introIcon, { backgroundColor: colors.secondary }]}><Feather name="camera" size={22} color={colors.primary} /></View><Text style={[styles.heading, { color: colors.foreground }]}>Quante foto volete?</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>Numero totale di foto da scattare durante l&apos;avventura.</Text></View>
          <View style={styles.grid}>{options.map((count) => <Pressable key={count} accessibilityRole="button" accessibilityLabel={`${count} foto`} onPress={() => setPhotoCount(count)} style={({ pressed }) => [styles.countOption, { borderColor: count === photoCount ? colors.primary : colors.border, backgroundColor: count === photoCount ? colors.primary : colors.card }, pressed && { opacity: 0.78 }]}><Text style={[styles.countText, { color: count === photoCount ? colors.primaryForeground : colors.foreground }]}>{count}</Text></Pressable>)}</View>
          <Text style={[styles.selectedCount, { color: colors.mutedForeground }]}>{photoCount} foto totali</Text>
          <PrimaryButton label="Avanti" icon="arrow-right" onPress={() => setStep(3)} style={styles.actionButton} />
        </>
      ) : (
        <>
          <View style={styles.intro}><View style={[styles.introIcon, { backgroundColor: colors.secondary }]}><Feather name="clock" size={22} color={colors.primary} /></View><Text style={[styles.heading, { color: colors.foreground }]}>Fascia oraria{'\n'}dell&apos;avventura</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>I vostri momenti fotografici verranno distribuiti a sorpresa durante questo intervallo.</Text></View>
          <View style={styles.timeStack}>
            {([{ field: 'start' as const, label: 'INIZIO', value: windowStart }, { field: 'end' as const, label: 'FINE', value: windowEnd }]).map(({ field, label, value }) => (
              <Pressable key={field} accessibilityRole="button" accessibilityLabel={`Scegli orario di ${label.toLowerCase()}`} testID={field === 'start' ? 'start-time-picker' : 'end-time-picker'} onPress={() => { const current = timeParts(value); setTimePicker({ field, ...current }); }} style={({ pressed }) => [styles.timeCard, { backgroundColor: colors.card, borderColor: colors.border }, pressed && styles.pressed]}>
                <Text style={[styles.timeLabel, { color: colors.mutedForeground }]}>{label}</Text>
                <Text style={[styles.timeValue, { color: colors.foreground }]}>{value}</Text>
                <Feather name="chevron-down" size={22} color={colors.foreground} />
              </Pressable>
            ))}
          </View>
          <PrimaryButton label="Crea gruppo" icon="arrow-right" onPress={() => void submit()} loading={createGroup.isPending} style={styles.actionButton} />
        </>
      )}
      <Modal visible={Boolean(timePicker)} transparent animationType="fade" onRequestClose={() => setTimePicker(null)}>
        <View style={[styles.modal, { backgroundColor: colors.foreground + '77' }]}>
          <View style={[styles.pickerSheet, { backgroundColor: colors.background }]}>
            <Text style={[styles.pickerTitle, { color: colors.foreground }]}>Scegli l&apos;orario</Text>
            <Text style={[styles.pickerHint, { color: colors.mutedForeground }]}>{timePicker?.field === 'start' ? 'Inizio della fascia' : 'Fine della fascia'}</Text>
            <View style={[styles.picker, { borderColor: colors.border }]}>
              <ScrollView ref={hourPickerRef} style={styles.pickerColumnScroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.pickerColumn} onContentSizeChange={() => scrollToTime(timePicker)}>
                {Array.from({ length: 24 }, (_, hour) => <Pressable key={hour} accessibilityRole="button" accessibilityLabel={`Ora ${String(hour).padStart(2, '0')}`} testID={`time-hour-${String(hour).padStart(2, '0')}`} onPress={() => setTimePicker((value) => value ? { ...value, hour } : value)} style={[styles.timeOption, timePicker?.hour === hour && { backgroundColor: colors.primary }]}><Text style={[styles.timeOptionText, { color: timePicker?.hour === hour ? colors.primaryForeground : colors.foreground }]}>{String(hour).padStart(2, '0')}</Text></Pressable>)}
              </ScrollView>
              <Text style={[styles.colon, { color: colors.foreground }]}>:</Text>
              <ScrollView ref={minutePickerRef} style={styles.pickerColumnScroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.pickerColumn} onContentSizeChange={() => scrollToTime(timePicker)}>
                {Array.from({ length: 60 }, (_, minute) => <Pressable key={minute} accessibilityRole="button" accessibilityLabel={`Minuti ${String(minute).padStart(2, '0')}`} testID={`time-minute-${String(minute).padStart(2, '0')}`} onPress={() => setTimePicker((value) => value ? { ...value, minute } : value)} style={[styles.timeOption, timePicker?.minute === minute && { backgroundColor: colors.primary }]}><Text style={[styles.timeOptionText, { color: timePicker?.minute === minute ? colors.primaryForeground : colors.foreground }]}>{String(minute).padStart(2, '0')}</Text></Pressable>)}
              </ScrollView>
            </View>
            <PrimaryButton label="Conferma orario" icon="check" onPress={() => { if (!timePicker) return; const value = formatTime(timePicker.hour, timePicker.minute); if (timePicker.field === 'start') setWindowStart(value); else setWindowEnd(value); setTimePicker(null); }} />
            <Pressable accessibilityRole="button" accessibilityLabel="Chiudi selettore orario" onPress={() => setTimePicker(null)} style={styles.cancel}><Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Annulla</Text></Pressable>
          </View>
        </View>
      </Modal>
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, paddingHorizontal: 22, paddingBottom: 34 },
  intro: { marginTop: 20 },
  introIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  heading: { fontFamily: 'Inter_700Bold', fontSize: 25, lineHeight: 30, letterSpacing: -0.8 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 21, marginTop: 8, maxWidth: 345 },
  nameInput: { height: 58, borderWidth: 1, borderRadius: 17, paddingHorizontal: 17, fontFamily: 'Inter_400Regular', fontSize: 17, marginTop: 33 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 11, marginTop: 33 },
  countOption: { width: '30.8%', aspectRatio: 1.22, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  countText: { fontFamily: 'Inter_700Bold', fontSize: 27, letterSpacing: -0.5 },
  selectedCount: { textAlign: 'center', fontFamily: 'Inter_400Regular', fontSize: 14, marginTop: 22 },
  actionButton: { marginTop: 'auto', marginBottom: 8 },
  timeStack: { gap: 13, marginTop: 33 },
  timeCard: { borderWidth: 1, borderRadius: 18, minHeight: 103, paddingHorizontal: 18, paddingVertical: 15, flexDirection: 'row', alignItems: 'center' },
  timeLabel: { position: 'absolute', left: 18, top: 14, fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.4 },
  timeValue: { fontFamily: 'Inter_700Bold', fontSize: 28, letterSpacing: -0.4, flex: 1, paddingTop: 21 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  modal: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 22 },
  pickerSheet: { width: '100%', maxWidth: 360, borderRadius: 25, padding: 21 },
  pickerTitle: { fontFamily: 'Inter_700Bold', fontSize: 21, textAlign: 'center' },
  pickerHint: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', marginTop: 5, marginBottom: 17 },
  picker: { height: 216, borderWidth: 1, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 18, overflow: 'hidden' },
  pickerColumnScroll: { flex: 1, alignSelf: 'stretch' },
  pickerColumn: { paddingVertical: 76, alignItems: 'center', gap: 6 },
  timeOption: { width: 80, height: 43, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  timeOptionText: { fontFamily: 'Inter_700Bold', fontSize: 21 },
  colon: { fontFamily: 'Inter_700Bold', fontSize: 23, marginHorizontal: 5 },
  cancel: { alignItems: 'center', paddingTop: 18 },
  cancelText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  successPage: { flex: 1, paddingHorizontal: 22, paddingBottom: 24 },
  successContent: { flex: 1, alignItems: 'center', paddingTop: 42 },
  successIcon: { width: 92, height: 92, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: 27 },
  successTitle: { fontFamily: 'Inter_700Bold', fontSize: 30, letterSpacing: -1 },
  successBody: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 300, marginTop: 9 },
  codeCard: { width: '100%', minHeight: 93, borderWidth: 1, borderRadius: 20, paddingHorizontal: 25, marginTop: 29, alignItems: 'center', justifyContent: 'center' },
  code: { fontFamily: 'Inter_700Bold', fontSize: 31, letterSpacing: 7 },
  inviteActions: { width: '100%', flexDirection: 'row', gap: 10, marginTop: 12 },
  inviteAction: { flex: 1, minHeight: 52, borderWidth: 1, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  inviteActionLabel: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  participantCard: { width: '100%', marginTop: 28, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15 },
  participantTitle: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  participantBody: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 4 },
  bottomButton: { marginBottom: 6 },
});
