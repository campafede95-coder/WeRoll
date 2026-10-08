import React from 'react';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { alpineMemory } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';

export default function LandingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={[styles.page, { backgroundColor: colors.foreground }]}>
      <Image source={alpineMemory} contentFit="cover" style={StyleSheet.absoluteFillObject} />
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.foreground, opacity: 0.43 }]} />
      <View style={[styles.content, { paddingTop: insets.top + 34, paddingBottom: insets.bottom + 28 }]}>
        <View>
          <Text style={[styles.eyebrow, { color: colors.primaryForeground }]}>ALBUM CONDIVISO PER AVVENTURE</Text>
          <Text style={[styles.title, { color: colors.primaryForeground }]}>Cattura i momenti,{'\n'}condividi{'\n'}l&apos;avventura.</Text>
          <Text style={[styles.body, { color: colors.primaryForeground }]}>Create un gruppo, programmate i vostri momenti e costruite insieme l&apos;album fotografico della giornata.</Text>
        </View>
        <View style={styles.options}>
          <Pressable accessibilityRole="button" accessibilityLabel="Crea un gruppo" onPress={() => router.push('/experience/create' as never)} style={({ pressed }) => [styles.option, { backgroundColor: colors.card }, pressed && { transform: [{ scale: 0.985 }], opacity: 0.92 }]}>
            <View style={[styles.optionIcon, { backgroundColor: colors.primary }]}><Feather name="plus" size={29} color={colors.primaryForeground} /></View>
            <View style={{ flex: 1 }}><Text style={[styles.optionTitle, { color: colors.foreground }]}>Crea un gruppo</Text><Text style={[styles.optionBody, { color: colors.mutedForeground }]}>Organizza l&apos;evento e invita gli amici</Text></View>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Entra in un gruppo" onPress={() => router.push('/join' as never)} style={({ pressed }) => [styles.option, { backgroundColor: colors.card }, pressed && { transform: [{ scale: 0.985 }], opacity: 0.92 }]}>
            <View style={[styles.optionIcon, { backgroundColor: colors.accent }]}><Feather name="log-in" size={27} color={colors.foreground} /></View>
            <View style={{ flex: 1 }}><Text style={[styles.optionTitle, { color: colors.foreground }]}>Entra in un gruppo</Text><Text style={[styles.optionBody, { color: colors.mutedForeground }]}>Inserisci il codice dell&apos;organizzatore</Text></View>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { flex: 1, justifyContent: 'space-between', paddingHorizontal: 23 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.6, opacity: 0.88 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 39, lineHeight: 42, letterSpacing: -1.55, marginTop: 15, maxWidth: 350 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 23, marginTop: 18, maxWidth: 330, opacity: 0.92 },
  options: { gap: 13 },
  option: { minHeight: 124, borderRadius: 24, padding: 17, flexDirection: 'row', alignItems: 'center', gap: 15 },
  optionIcon: { width: 65, height: 65, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  optionTitle: { fontFamily: 'Inter_700Bold', fontSize: 19, letterSpacing: -0.35 },
  optionBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 19, marginTop: 5, paddingRight: 6 },
});