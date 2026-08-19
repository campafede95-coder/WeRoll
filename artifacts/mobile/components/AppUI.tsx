import React, { PropsWithChildren } from 'react';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ActivityIndicator,
  Dimensions,
  ImageSourcePropType,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Experience, ExperienceStatus, Participant } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

export const alpineMemory = require('@/assets/images/alpine-memory.jpg') as ImageSourcePropType;
const { width: screenWidth } = Dimensions.get('window');

export function formatDate(value?: string, includeYear = false) {
  if (!value) return 'Data da definire';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', ...(includeYear ? { year: 'numeric' } : {}) });
}

export function formatDateTime(value?: string) {
  if (!value) return 'Orario da definire';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${formatDate(value)} · ${date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
}

export function Screen({ children, scroll = true, style }: PropsWithChildren<{ scroll?: boolean; style?: StyleProp<ViewStyle> }>) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const webTop = Platform.OS === 'web' ? 67 : 0;
  const webBottom = Platform.OS === 'web' ? 34 : 0;
  const content = (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + webTop }, style]}>
      {children}
    </View>
  );
  if (!scroll) return content;
  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: insets.bottom + webBottom + 108 }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: colors.background }}
    >
      {content}
    </ScrollView>
  );
}

export function AppHeader({ title, eyebrow, back = false, action }: { title: string; eyebrow?: string; back?: boolean; action?: React.ReactNode }) {
  const colors = useColors();
  const router = useRouter();
  return (
    <View style={styles.header}>
      <View style={styles.headerLead}>
        {back ? (
          <IconButton icon="arrow-left" accessibilityLabel="Indietro" onPress={() => router.back()} style={{ marginRight: 10 }} />
        ) : null}
        <View style={{ flex: 1 }}>
          {eyebrow ? <Text style={[styles.eyebrow, { color: colors.primary }]}>{eyebrow}</Text> : null}
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>{title}</Text>
        </View>
      </View>
      {action}
    </View>
  );
}

export function PrimaryButton({ label, icon, onPress, disabled = false, loading = false, variant = 'primary', style }: {
  label: string; icon?: keyof typeof Feather.glyphMap; onPress: () => void; disabled?: boolean; loading?: boolean; variant?: 'primary' | 'soft' | 'quiet'; style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || loading}
      onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
      style={({ pressed }) => [
        styles.primaryButton,
        { backgroundColor: variant === 'primary' ? colors.primary : variant === 'soft' ? colors.secondary : 'transparent' },
        variant === 'quiet' && { borderColor: colors.border, borderWidth: 1 },
        (disabled || loading) && { opacity: 0.48 },
        pressed && !disabled && { transform: [{ scale: 0.98 }] },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={variant === 'primary' ? colors.primaryForeground : colors.foreground} /> : null}
      {!loading && icon ? <Feather name={icon} size={17} color={variant === 'primary' ? colors.primaryForeground : colors.foreground} /> : null}
      <Text style={[styles.buttonLabel, { color: variant === 'primary' ? colors.primaryForeground : colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({ icon, onPress, accessibilityLabel, style, color }: { icon: keyof typeof Feather.glyphMap; onPress: () => void; accessibilityLabel: string; style?: StyleProp<ViewStyle>; color?: string }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => { void Haptics.selectionAsync(); onPress(); }}
      style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.55 }, style]}
    >
      <Feather name={icon} size={21} color={color ?? colors.foreground} />
    </Pressable>
  );
}

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.foreground }]}>{label}</Text>
      <TextInput
        {...props}
        placeholderTextColor={colors.mutedForeground}
        style={[styles.input, { backgroundColor: colors.card, borderColor: colors.input, color: colors.foreground }]}
      />
      {hint ? <Text style={[styles.hint, { color: colors.mutedForeground }]}>{hint}</Text> : null}
    </View>
  );
}

export function Surface({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const colors = useColors();
  return <View style={[styles.surface, { backgroundColor: colors.card, borderColor: colors.border }, style]}>{children}</View>;
}

export function StatusPill({ status }: { status: ExperienceStatus }) {
  const colors = useColors();
  const labels: Record<ExperienceStatus, string> = { upcoming: 'In arrivo', ongoing: 'In corso', completed: 'Conclusa' };
  const tone: Record<ExperienceStatus, string> = { upcoming: colors.accent, ongoing: colors.secondary, completed: colors.muted };
  return <View style={[styles.statusPill, { backgroundColor: tone[status] }]}><Text style={[styles.statusText, { color: colors.foreground }]}>{labels[status]}</Text></View>;
}

export function ExperienceCard({ experience }: { experience: Experience }) {
  const colors = useColors();
  const router = useRouter();
  const imageUri = experience.coverImageUri || alpineMemory;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Apri ${experience.name}`}
        onPress={() => { void Haptics.selectionAsync(); router.push({ pathname: '/experience/[id]', params: { id: experience.id, experienceId: experience.id } }); }}
      style={({ pressed }) => [styles.experienceCard, { backgroundColor: colors.card, borderColor: colors.border }, pressed && { transform: [{ scale: 0.985 }], opacity: 0.9 }]}
    >
      <Image source={imageUri} contentFit="cover" transition={220} style={styles.experienceImage} />
      <View style={styles.experienceShade} />
      <View style={styles.experienceCardTop}><StatusPill status={experience.status} /><Feather name="arrow-up-right" size={20} color={colors.primaryForeground} /></View>
      <View style={styles.experienceCopy}>
        <Text numberOfLines={1} style={[styles.cardTitle, { color: colors.primaryForeground }]}>{experience.name}</Text>
        <Text numberOfLines={1} style={[styles.cardMeta, { color: colors.primaryForeground }]}>{formatDate(experience.startDate, true)} {experience.location ? `· ${experience.location}` : ''}</Text>
        <View style={styles.cardFooter}><Feather name="users" size={14} color={colors.primaryForeground} /><Text style={[styles.cardMeta, { color: colors.primaryForeground }]}>{experience.participantCount} partecipanti</Text></View>
      </View>
    </Pressable>
  );
}

export function AvatarStack({ participants, count }: { participants: Participant[]; count?: number }) {
  const colors = useColors();
  const shown = participants.slice(0, 4);
  return (
    <View style={styles.avatarStack}>
      {shown.map((participant, index) => participant.avatarUrl ? (
        <Image key={participant.id} source={{ uri: participant.avatarUrl }} style={[styles.avatar, { borderColor: colors.card, marginLeft: index ? -9 : 0 }]} />
      ) : (
        <View key={participant.id} style={[styles.avatar, styles.avatarFallback, { backgroundColor: index % 2 ? colors.primary : colors.accent, borderColor: colors.card, marginLeft: index ? -9 : 0 }]}><Text style={[styles.avatarInitial, { color: colors.foreground }]}>{participant.displayName.slice(0, 1).toUpperCase()}</Text></View>
      ))}
      {count && count > shown.length ? <View style={[styles.avatar, styles.avatarCount, { backgroundColor: colors.secondary, borderColor: colors.card }]}><Text style={[styles.avatarInitial, { color: colors.foreground }]}>+{count - shown.length}</Text></View> : null}
    </View>
  );
}

export function EmptyState({ title, body, icon = 'image' }: { title: string; body: string; icon?: keyof typeof Feather.glyphMap }) {
  const colors = useColors();
  return <Surface style={styles.empty}><View style={[styles.emptyIcon, { backgroundColor: colors.secondary }]}><Feather name={icon} size={24} color={colors.primary} /></View><Text style={[styles.emptyTitle, { color: colors.foreground }]}>{title}</Text><Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>{body}</Text></Surface>;
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const colors = useColors();
  return <Surface style={styles.empty}><View style={[styles.emptyIcon, { backgroundColor: colors.muted }]}><Feather name="wifi-off" size={22} color={colors.destructive} /></View><Text style={[styles.emptyTitle, { color: colors.foreground }]}>Non riusciamo a caricare il collettivo</Text><Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>Controlla la connessione e riprova tra un momento.</Text><PrimaryButton label="Riprova" icon="refresh-cw" onPress={onRetry} variant="soft" style={{ alignSelf: 'center', marginTop: 16 }} /></Surface>;
}

export function SkeletonList() {
  const colors = useColors();
  return <View style={{ gap: 14 }}>{[1, 2].map((item) => <View key={item} style={[styles.skeleton, { backgroundColor: colors.muted }]} />)}</View>;
}

export const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 20 },
  header: { minHeight: 74, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12 },
  headerLead: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  eyebrow: { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1.7, textTransform: 'uppercase', marginBottom: 3 },
  headerTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', letterSpacing: -0.8 },
  primaryButton: { minHeight: 52, paddingHorizontal: 18, borderRadius: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  buttonLabel: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  iconButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  field: { marginBottom: 17 },
  fieldLabel: { fontSize: 13, fontFamily: 'Inter_700Bold', marginBottom: 8 },
  input: { minHeight: 52, borderWidth: 1, borderRadius: 15, paddingHorizontal: 15, fontSize: 15, fontFamily: 'Inter_400Regular' },
  hint: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 6 },
  surface: { borderRadius: 22, borderWidth: 1, padding: 18 },
  experienceCard: { height: Math.min(screenWidth * 0.92, 380), minHeight: 310, borderRadius: 25, overflow: 'hidden', borderWidth: 1, justifyContent: 'space-between' },
  experienceImage: { ...StyleSheet.absoluteFillObject },
  experienceShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 35, 31, 0.28)' },
  experienceCardTop: { padding: 17, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  experienceCopy: { padding: 18 },
  cardTitle: { fontSize: 25, fontFamily: 'Inter_700Bold', letterSpacing: -0.6 },
  cardMeta: { fontSize: 13, fontFamily: 'Inter_500Medium', marginTop: 5 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 14 },
  statusPill: { borderRadius: 99, paddingHorizontal: 10, paddingVertical: 6 },
  statusText: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  avatarStack: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  avatarFallback: { overflow: 'hidden' },
  avatarCount: { marginLeft: -9 },
  avatarInitial: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  empty: { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 22 },
  emptyIcon: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  emptyBody: { fontSize: 14, lineHeight: 20, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 8, maxWidth: 280 },
  skeleton: { height: 135, borderRadius: 22, opacity: 0.7 },
});