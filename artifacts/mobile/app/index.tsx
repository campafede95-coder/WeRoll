import React, { useState } from 'react';
import { useJoinExperience } from '@workspace/api-client-react';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton, alpineMemory } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';

export default function LandingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const joinMutation = useJoinExperience();
  const [joinOpen, setJoinOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const join = () => {
    if (!code.trim()) return;
    setError('');
    joinMutation.mutate({ data: { inviteCode: code.trim() } }, {
      onSuccess: (group) => {
        setJoinOpen(false);
        router.replace(`/experience/${group.id}` as never);
      },
      onError: () => setError('Questo codice non sembra valido. Controllalo e riprova.'),
    });
  };
  return (
    <View style={[styles.page, { backgroundColor: colors.foreground }]}>
      <Image source={alpineMemory} contentFit="cover" style={StyleSheet.absoluteFillObject} />
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.foreground, opacity: 0.43 }]} />
      <View style={[styles.content, { paddingTop: insets.top + 34, paddingBottom: insets.bottom + 28 }]}>
        <View>
          <Text style={[styles.eyebrow, { color: colors.primaryForeground }]}>ALBUM CONDIVISO PER AVVENTURE</Text>
          <Text style={[styles.title, { color: colors.primaryForeground }]}>Cattura i momenti,{'\n'}condividi{'\n'}l&apos;avventura.</Text>
          <Text style={[styles.body, { color: colors.primaryForeground }]}>Create un gruppo, impostate le sveglie e costruite insieme un album fotografico della vostra giornata.</Text>
        </View>
        <View style={styles.options}>
          <Pressable accessibilityRole="button" accessibilityLabel="Crea un gruppo" onPress={() => router.push('/experience/create' as never)} style={({ pressed }) => [styles.option, { backgroundColor: colors.card }, pressed && { transform: [{ scale: 0.985 }], opacity: 0.92 }]}>
            <View style={[styles.optionIcon, { backgroundColor: colors.primary }]}><Feather name="plus" size={29} color={colors.primaryForeground} /></View>
            <View style={{ flex: 1 }}><Text style={[styles.optionTitle, { color: colors.foreground }]}>Crea un gruppo</Text><Text style={[styles.optionBody, { color: colors.mutedForeground }]}>Organizza l&apos;evento e invita gli amici</Text></View>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Entra in un gruppo" onPress={() => setJoinOpen(true)} style={({ pressed }) => [styles.option, { backgroundColor: colors.card }, pressed && { transform: [{ scale: 0.985 }], opacity: 0.92 }]}>
            <View style={[styles.optionIcon, { backgroundColor: colors.accent }]}><Feather name="log-in" size={27} color={colors.foreground} /></View>
            <View style={{ flex: 1 }}><Text style={[styles.optionTitle, { color: colors.foreground }]}>Entra in un gruppo</Text><Text style={[styles.optionBody, { color: colors.mutedForeground }]}>Inserisci il codice dell&apos;organizzatore</Text></View>
          </Pressable>
        </View>
      </View>
      <Modal visible={joinOpen} transparent animationType="slide" onRequestClose={() => setJoinOpen(false)}>
        <View style={[styles.modal, { backgroundColor: colors.foreground + '88' }]}>
          <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + 22 }]}>
            <Pressable accessibilityRole="button" accessibilityLabel="Chiudi" onPress={() => setJoinOpen(false)} style={styles.close}><Feather name="x" size={22} color={colors.foreground} /></Pressable>
            <Text style={[styles.sheetKicker, { color: colors.primary }]}>CODICE DEL GRUPPO</Text>
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Entrate nell&apos;avventura.</Text>
            <Text style={[styles.sheetBody, { color: colors.mutedForeground }]}>Chiedete all&apos;organizzatore il codice che vede nella lobby.</Text>
            <TextInput value={code} onChangeText={(value) => setCode(value.toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={8} placeholder="ES. FLUCRH" placeholderTextColor={colors.mutedForeground} style={[styles.codeInput, { backgroundColor: colors.card, borderColor: colors.input, color: colors.foreground }]} />
            {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
            <PrimaryButton label="Entra nel gruppo" icon="arrow-right" onPress={join} loading={joinMutation.isPending} disabled={!code.trim()} />
          </View>
        </View>
      </Modal>
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
  modal: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 22, paddingTop: 30 },
  close: { position: 'absolute', top: 15, right: 14, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sheetKicker: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.7 },
  sheetTitle: { fontFamily: 'Inter_700Bold', fontSize: 29, letterSpacing: -0.8, marginTop: 7 },
  sheetBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: 22 },
  codeInput: { height: 60, borderWidth: 1, borderRadius: 17, paddingHorizontal: 17, fontFamily: 'Inter_700Bold', fontSize: 20, letterSpacing: 3, marginBottom: 12 },
  error: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18, marginBottom: 12 },
});