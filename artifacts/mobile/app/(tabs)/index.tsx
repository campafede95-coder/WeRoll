import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useJoinExperience, getListExperiencesQueryKey, useListExperiences } from '@workspace/api-client-react';
import { Feather } from '@expo/vector-icons';
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, AppHeader, ExperienceCard, EmptyState, ErrorState, SkeletonList, PrimaryButton } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';

export default function HomeScreen() {
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const experiences = useListExperiences({ query: { queryKey: getListExperiencesQueryKey() } });
  const joinMutation = useJoinExperience();
  const [joinOpen, setJoinOpen] = useState(false);
  const [code, setCode] = useState('');
  const join = () => {
    if (!code.trim()) return;
    joinMutation.mutate({ data: { inviteCode: code.trim() } }, { onSuccess: () => { setJoinOpen(false); setCode(''); void queryClient.invalidateQueries({ queryKey: getListExperiencesQueryKey() }); }, onError: () => Alert.alert('Codice non valido', 'Controlla il codice e riprova.') });
  };
  return (
    <Screen>
      <AppHeader eyebrow="PIC SYNC COLLECTIVE" title="Le vostre storie" action={<Pressable accessibilityRole="button" accessibilityLabel="Apri profilo" onPress={() => router.push('/(tabs)/profile' as never)} style={({ pressed }) => [styles.profileButton, { backgroundColor: colors.secondary }, pressed && { opacity: 0.65 }]}><Feather name="user" size={18} color={colors.foreground} /></Pressable>} />
      <View style={styles.introRow}><View style={{ flex: 1 }}><Text style={[styles.intro, { color: colors.mutedForeground }]}>Ogni esperienza merita{'\n'}una foto in più.</Text></View><View style={[styles.sun, { backgroundColor: colors.accent }]}><Feather name="sun" size={19} color={colors.foreground} /></View></View>
      <View style={styles.actions}><PrimaryButton label="Nuova esperienza" icon="plus" onPress={() => router.push('/experience/create' as never)} style={{ flex: 1 }} /><Pressable accessibilityRole="button" accessibilityLabel="Unisciti a un'esperienza" onPress={() => setJoinOpen(true)} style={({ pressed }) => [styles.joinButton, { borderColor: colors.border, backgroundColor: colors.card }, pressed && { opacity: 0.65 }]}><Feather name="link" size={17} color={colors.foreground} /><Text style={[styles.joinText, { color: colors.foreground }]}>Unisciti</Text></Pressable></View>
      <View style={styles.listHeader}><Text style={[styles.sectionTitle, { color: colors.foreground }]}>Le vostre esperienze</Text><Text style={[styles.count, { color: colors.mutedForeground }]}>{experiences.data?.length ?? 0}</Text></View>
      {experiences.isLoading ? <SkeletonList /> : experiences.isError ? <ErrorState onRetry={() => void experiences.refetch()} /> : experiences.data?.length ? <View style={{ gap: 15 }}>{experiences.data.map((item) => <ExperienceCard key={item.id} experience={item} />)}</View> : <EmptyState icon="compass" title="La prima storia aspetta voi" body="Create un'esperienza o usate un codice invito per iniziare a raccogliere ricordi." />}
      <Modal visible={joinOpen} transparent animationType="slide" onRequestClose={() => setJoinOpen(false)}>
        <View style={[styles.modalBackdrop, { backgroundColor: colors.foreground + '55' }]}><View style={[styles.sheet, { backgroundColor: colors.background }]}><View style={[styles.sheetHandle, { backgroundColor: colors.border }]} /><Pressable accessibilityRole="button" accessibilityLabel="Chiudi" onPress={() => setJoinOpen(false)} style={styles.close}><Feather name="x" size={22} color={colors.foreground} /></Pressable><Text style={[styles.sheetKicker, { color: colors.primary }]}>CODICE INVITO</Text><Text style={[styles.sheetTitle, { color: colors.foreground }]}>Entrate nella storia.</Text><Text style={[styles.sheetBody, { color: colors.mutedForeground }]}>Chiedete a chi ha creato l'esperienza il suo codice di quattro caratteri.</Text><TextInput value={code} onChangeText={setCode} autoCapitalize="characters" maxLength={12} placeholder="Es. ALPI24" placeholderTextColor={colors.mutedForeground} style={[styles.codeInput, { backgroundColor: colors.card, borderColor: colors.input, color: colors.foreground }]} /><PrimaryButton label="Unisciti all'esperienza" icon="arrow-right" onPress={join} loading={joinMutation.isPending} disabled={!code.trim()} /></View></View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  profileButton: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  introRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, marginBottom: 23 },
  intro: { fontFamily: 'Inter_400Regular', fontSize: 17, lineHeight: 23 },
  sun: { width: 48, height: 48, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: 9, marginBottom: 31 },
  joinButton: { minHeight: 52, paddingHorizontal: 16, borderRadius: 17, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  joinText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  listHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 13 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 19, letterSpacing: -0.3 },
  count: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 29, borderTopRightRadius: 29, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 33 },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 4, marginBottom: 15 },
  close: { position: 'absolute', right: 16, top: 20, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  sheetKicker: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.7, marginTop: 16, marginBottom: 8 },
  sheetTitle: { fontFamily: 'Inter_700Bold', fontSize: 29, letterSpacing: -1 },
  sheetBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: 22 },
  codeInput: { height: 56, borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, fontFamily: 'Inter_700Bold', fontSize: 17, letterSpacing: 2, marginBottom: 13 },
});
