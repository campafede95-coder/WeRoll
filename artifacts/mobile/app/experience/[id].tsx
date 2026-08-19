import React from 'react';
import { getGetExperienceQueryKey, useGetExperience } from '@workspace/api-client-react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Screen, AppHeader, EmptyState, ErrorState, SkeletonList, PrimaryButton, Surface, StatusPill, AvatarStack, formatDate, formatDateTime, alpineMemory } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';

export default function ExperienceDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useGetExperience(id, { query: { queryKey: getGetExperienceQueryKey(id), enabled: Boolean(id) } });
  const experience = query.data;
  if (query.isLoading) return <Screen><AppHeader title="Caricamento" back /><SkeletonList /></Screen>;
  if (query.isError || !experience) return <Screen><AppHeader title="Esperienza" back /><ErrorState onRetry={() => void query.refetch()} /></Screen>;
  return (
    <Screen>
      <AppHeader title="" back action={<Pressable accessibilityRole="button" accessibilityLabel="Condividi codice invito" onPress={() => Alert.alert('Codice invito', experience.inviteCode)}><Feather name="share-2" size={19} color={colors.foreground} /></Pressable>} />
      <View style={styles.hero}><Image source={experience.coverImageUri || alpineMemory} contentFit="cover" transition={240} style={styles.heroImage} /><View style={[styles.heroShade, { backgroundColor: colors.foreground }]} /><View style={styles.heroText}><StatusPill status={experience.status} /><Text style={[styles.heroTitle, { color: colors.primaryForeground }]}>{experience.name}</Text><Text style={[styles.heroMeta, { color: colors.primaryForeground }]}>{formatDate(experience.startDate, true)} {experience.location ? `· ${experience.location}` : ''}</Text></View></View>
      {experience.description ? <Text style={[styles.description, { color: colors.mutedForeground }]}>{experience.description}</Text> : null}
      <View style={styles.quickActions}><Pressable accessibilityRole="button" accessibilityLabel="Cattura un ricordo" onPress={() => router.push(`/capture/${id}` as never)} style={[styles.quickAction, { backgroundColor: colors.primary }]}><Feather name="camera" size={18} color={colors.primaryForeground} /><Text style={[styles.quickText, { color: colors.primaryForeground }]}>Cattura</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Aggiungi promemoria" onPress={() => router.push(`/experience/${id}/reminder` as never)} style={[styles.quickAction, { backgroundColor: colors.secondary }]}><Feather name="bell" size={18} color={colors.foreground} /><Text style={[styles.quickText, { color: colors.foreground }]}>Promemoria</Text></Pressable></View>
      <View style={styles.sectionHead}><Text style={[styles.sectionTitle, { color: colors.foreground }]}>Il gruppo</Text><Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>{experience.participantCount} persone</Text></View>
      <Surface style={styles.groupCard}><AvatarStack participants={experience.participants} count={experience.participantCount} /><View style={{ flex: 1, marginLeft: 13 }}><Text style={[styles.groupTitle, { color: colors.foreground }]}>{experience.participants.length ? experience.participants.slice(0, 2).map((participant) => participant.displayName).join(', ') : 'Il tuo gruppo'}</Text><Text style={[styles.groupBody, { color: colors.mutedForeground }]}>Codice {experience.inviteCode}</Text></View><Feather name="copy" size={17} color={colors.primary} /></Surface>
      <View style={styles.sectionHead}><Text style={[styles.sectionTitle, { color: colors.foreground }]}>Promemoria</Text><Pressable accessibilityRole="button" accessibilityLabel="Aggiungi promemoria" onPress={() => router.push(`/experience/${id}/reminder` as never)}><Text style={[styles.addText, { color: colors.primary }]}>Aggiungi</Text></Pressable></View>
      {experience.reminders.length ? <View style={{ gap: 9 }}>{experience.reminders.map((reminder) => <Surface key={reminder.id} style={styles.reminder}><View style={[styles.reminderIcon, { backgroundColor: colors.accent }]}><Feather name="camera" size={17} color={colors.foreground} /></View><View style={{ flex: 1 }}><Text style={[styles.reminderTitle, { color: colors.foreground }]}>{reminder.title}</Text><Text style={[styles.reminderBody, { color: colors.mutedForeground }]}>{formatDateTime(reminder.scheduledAt)}</Text></View><Feather name="chevron-right" size={18} color={colors.mutedForeground} /></Surface>)}</View> : <EmptyState icon="bell" title="Nessun invito ancora" body="Un promemoria gentile può trasformare un momento qualsiasi in un ricordo." />}
      <View style={styles.sectionHead}><Text style={[styles.sectionTitle, { color: colors.foreground }]}>Album condiviso</Text><Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>{experience.memories.length} foto</Text></View>
      {experience.memories.length ? <View style={styles.album}>{experience.memories.map((memory) => <View key={memory.id} style={styles.memory}><Image source={{ uri: memory.imageUri }} contentFit="cover" style={styles.memoryImage} /><View style={styles.memoryCaption}><Text numberOfLines={1} style={[styles.memoryAuthor, { color: colors.foreground }]}>{memory.authorName}</Text><Text style={[styles.memoryTime, { color: colors.mutedForeground }]}>{formatDate(memory.capturedAt)}</Text></View></View>)}</View> : <EmptyState icon="image" title="L'album è ancora vuoto" body="Siate i primi a fermare la luce di oggi." />}
      <PrimaryButton label="Apri la fotocamera" icon="camera" onPress={() => router.push(`/capture/${id}` as never)} style={{ marginTop: 19 }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { height: 318, borderRadius: 25, overflow: 'hidden', justifyContent: 'flex-end' },
  heroImage: { ...StyleSheet.absoluteFillObject },
  heroShade: { ...StyleSheet.absoluteFillObject, opacity: 0.35 },
  heroText: { padding: 18 },
  heroTitle: { fontFamily: 'Inter_700Bold', fontSize: 29, letterSpacing: -1, marginTop: 16 },
  heroMeta: { fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 5 },
  description: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, marginTop: 16 },
  quickActions: { flexDirection: 'row', gap: 9, marginTop: 19, marginBottom: 29 },
  quickAction: { flex: 1, minHeight: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  quickText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 11, marginTop: 3 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 19, letterSpacing: -0.3 },
  sectionHint: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  groupCard: { flexDirection: 'row', alignItems: 'center', padding: 14, marginBottom: 28 },
  groupTitle: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  groupBody: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 4 },
  addText: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  reminder: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 11 },
  reminderIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  reminderTitle: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  reminderBody: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 4 },
  album: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  memory: { width: '48%', marginBottom: 5 },
  memoryImage: { width: '100%', aspectRatio: 0.95, borderRadius: 17 },
  memoryCaption: { paddingTop: 6, paddingHorizontal: 2 },
  memoryAuthor: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  memoryTime: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },
});