import React, { useState } from 'react';
import { useCreateExperience } from '@workspace/api-client-react';
import { Feather } from '@expo/vector-icons';
import { Alert, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { AppHeader, PrimaryButton, Surface } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';

const options = [6, 12, 18, 24, 30, 36];

function todayAt(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  const date = new Date();
  date.setHours(hours || 0, minutes || 0, 0, 0);
  return date;
}

export default function CreateGroupScreen() {
  const colors = useColors();
  const router = useRouter();
  const createGroup = useCreateExperience();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [photoCount, setPhotoCount] = useState(12);
  const [windowStart, setWindowStart] = useState('09:00');
  const [windowEnd, setWindowEnd] = useState('18:00');
  const [created, setCreated] = useState<{ id: string; inviteCode: string } | null>(null);

  const submit = () => {
    if (!/^\d{2}:\d{2}$/.test(windowStart) || !/^\d{2}:\d{2}$/.test(windowEnd) || todayAt(windowEnd) <= todayAt(windowStart)) {
      Alert.alert('Controlla gli orari', 'Inserisci una fascia valida, ad esempio dalle 09:00 alle 18:00.');
      return;
    }
    createGroup.mutate({
      data: {
        name: 'La nostra avventura',
        startDate: todayAt(windowStart).toISOString(),
        endDate: todayAt(windowEnd).toISOString(),
        targetPhotoCount: photoCount,
        windowStart,
        windowEnd,
      },
    }, {
      onSuccess: (group) => {
        setCreated({ id: group.id, inviteCode: group.inviteCode });
        setStep(3);
      },
      onError: () => Alert.alert('Non riusciamo a creare il gruppo', 'Riprova tra un momento.'),
    });
  };

  if (step === 3 && created) {
    return (
      <View style={[styles.successPage, { backgroundColor: colors.background }]}>
        <AppHeader title="Gruppo creato" back />
        <View style={styles.successContent}>
          <View style={[styles.successIcon, { backgroundColor: colors.secondary }]}><Feather name="check" size={44} color={colors.primary} /></View>
          <Text style={[styles.successTitle, { color: colors.foreground }]}>Gruppo creato!</Text>
          <Text style={[styles.successBody, { color: colors.mutedForeground }]}>Condividi il codice con i partecipanti. Entreranno senza creare un account.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Condividi il codice" onPress={() => void Share.share({ message: `Entra nel mio gruppo Pic Sync con il codice: ${created.inviteCode}` })} style={[styles.codeCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Text style={[styles.code, { color: colors.foreground }]}>{created.inviteCode}</Text>
            <Feather name="copy" size={23} color={colors.primary} />
          </Pressable>
          <Text style={[styles.copyHint, { color: colors.mutedForeground }]}>Tocca per condividere il codice</Text>
          <Surface style={styles.participantCard}><Feather name="users" size={19} color={colors.primary} /><View><Text style={[styles.participantTitle, { color: colors.foreground }]}>Partecipanti collegati (1)</Text><Text style={[styles.participantBody, { color: colors.mutedForeground }]}>Organizzatore · tu</Text></View></Surface>
        </View>
        <PrimaryButton label="Vai alla sessione" icon="arrow-right" onPress={() => router.replace(`/experience/${created.id}` as never)} style={styles.bottomButton} />
      </View>
    );
  }

  return (
    <KeyboardAwareScrollViewCompat contentContainerStyle={[styles.page, { backgroundColor: colors.background }]}>
      <AppHeader title="Crea un gruppo" back />
      {step === 1 ? (
        <>
          <View style={styles.intro}><View style={[styles.introIcon, { backgroundColor: colors.secondary }]}><Feather name="camera" size={22} color={colors.primary} /></View><Text style={[styles.heading, { color: colors.foreground }]}>Quante foto volete?</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>Numero totale di foto da scattare durante l&apos;avventura.</Text></View>
          <View style={styles.grid}>{options.map((count) => <Pressable key={count} accessibilityRole="button" accessibilityLabel={`${count} foto`} onPress={() => setPhotoCount(count)} style={({ pressed }) => [styles.countOption, { borderColor: count === photoCount ? colors.primary : colors.border, backgroundColor: count === photoCount ? colors.primary : colors.card }, pressed && { opacity: 0.78 }]}><Text style={[styles.countText, { color: count === photoCount ? colors.primaryForeground : colors.foreground }]}>{count}</Text></Pressable>)}</View>
          <Text style={[styles.selectedCount, { color: colors.mutedForeground }]}>{photoCount} foto totali</Text>
          <PrimaryButton label="Avanti" icon="arrow-right" onPress={() => setStep(2)} style={styles.actionButton} />
        </>
      ) : (
        <>
          <View style={styles.intro}><View style={[styles.introIcon, { backgroundColor: colors.secondary }]}><Feather name="clock" size={22} color={colors.primary} /></View><Text style={[styles.heading, { color: colors.foreground }]}>Fascia oraria{'\n'}dell&apos;avventura</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>Le sveglie verranno distribuite in modo equilibrato in questo intervallo. Potrai cambiarle nella lobby.</Text></View>
          <View style={styles.timeStack}>
            <View style={[styles.timeCard, { backgroundColor: colors.card, borderColor: colors.border }]}><Text style={[styles.timeLabel, { color: colors.mutedForeground }]}>INIZIO</Text><TextInput value={windowStart} onChangeText={setWindowStart} keyboardType="numbers-and-punctuation" maxLength={5} style={[styles.timeInput, { color: colors.foreground }]} /><Feather name="clock" size={22} color={colors.foreground} /></View>
            <View style={[styles.timeCard, { backgroundColor: colors.card, borderColor: colors.border }]}><Text style={[styles.timeLabel, { color: colors.mutedForeground }]}>FINE</Text><TextInput value={windowEnd} onChangeText={setWindowEnd} keyboardType="numbers-and-punctuation" maxLength={5} style={[styles.timeInput, { color: colors.foreground }]} /><Feather name="clock" size={22} color={colors.foreground} /></View>
          </View>
          <PrimaryButton label="Crea gruppo" icon="arrow-right" onPress={submit} loading={createGroup.isPending} style={styles.actionButton} />
        </>
      )}
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, paddingHorizontal: 22, paddingBottom: 34 },
  intro: { marginTop: 20 },
  introIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  heading: { fontFamily: 'Inter_700Bold', fontSize: 25, lineHeight: 30, letterSpacing: -0.8 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 21, marginTop: 8, maxWidth: 345 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 11, marginTop: 33 },
  countOption: { width: '30.8%', aspectRatio: 1.22, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  countText: { fontFamily: 'Inter_700Bold', fontSize: 27, letterSpacing: -0.5 },
  selectedCount: { textAlign: 'center', fontFamily: 'Inter_400Regular', fontSize: 14, marginTop: 22 },
  actionButton: { marginTop: 'auto', marginBottom: 8 },
  timeStack: { gap: 13, marginTop: 33 },
  timeCard: { borderWidth: 1, borderRadius: 18, minHeight: 103, paddingHorizontal: 18, paddingVertical: 15, flexDirection: 'row', alignItems: 'center' },
  timeLabel: { position: 'absolute', left: 18, top: 14, fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.4 },
  timeInput: { fontFamily: 'Inter_700Bold', fontSize: 28, letterSpacing: -0.4, flex: 1, paddingTop: 21 },
  successPage: { flex: 1, paddingHorizontal: 22, paddingBottom: 24 },
  successContent: { flex: 1, alignItems: 'center', paddingTop: 42 },
  successIcon: { width: 92, height: 92, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: 27 },
  successTitle: { fontFamily: 'Inter_700Bold', fontSize: 30, letterSpacing: -1 },
  successBody: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 300, marginTop: 9 },
  codeCard: { width: '100%', minHeight: 93, borderWidth: 1, borderRadius: 20, paddingHorizontal: 25, marginTop: 29, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  code: { fontFamily: 'Inter_700Bold', fontSize: 31, letterSpacing: 7 },
  copyHint: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 10 },
  participantCard: { width: '100%', marginTop: 28, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15 },
  participantTitle: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  participantBody: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 4 },
  bottomButton: { marginBottom: 6 },
});