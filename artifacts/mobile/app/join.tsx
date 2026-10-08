import React, { useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useJoinExperience } from '@workspace/api-client-react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppHeader, PrimaryButton, Screen } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';

export default function JoinGroupScreen() {
  const colors = useColors();
  const router = useRouter();
  const input = useRef<TextInput>(null);
  const join = useJoinExperience();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const submit = async () => {
    if (code.length !== 6 || !name.trim()) return;
    setError('');
    await AsyncStorage.setItem('pic-sync-guest-name', name.trim());
    join.mutate({ data: { inviteCode: code, displayName: name.trim() } }, {
      onSuccess: (group) => router.replace({ pathname: '/experience/[id]', params: { id: group.id, experienceId: group.id } }),
      onError: () => setError('Codice non valido. Controllalo e riprova.'),
    });
  };
  return (
    <Screen scroll={false}>
      <AppHeader title="Entra in un gruppo" back />
      <View style={styles.content}>
        <View>
          <Text style={[styles.label, { color: colors.foreground }]}>Inserisci il codice</Text>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>Chiedi all&apos;organizzatore il codice del gruppo</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Codice del gruppo" onPress={() => input.current?.focus()} style={[styles.codeBoxes, { borderColor: colors.border, backgroundColor: colors.card }]}>
            {Array.from({ length: 6 }, (_, index) => <View key={index} style={[styles.codeCell, index < 5 && { borderRightWidth: 1, borderRightColor: colors.border }]}><Text style={[styles.codeChar, { color: colors.foreground }]}>{code[index] ?? ''}</Text></View>)}
            <TextInput ref={input} value={code} onChangeText={(value) => setCode(value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} autoCapitalize="characters" autoCorrect={false} maxLength={6} style={styles.hiddenInput} />
          </Pressable>
          <Text style={[styles.label, { color: colors.foreground, marginTop: 39 }]}>Il tuo nome</Text>
          <TextInput value={name} onChangeText={setName} autoCapitalize="words" maxLength={40} placeholder="Come ti chiami?" placeholderTextColor={colors.mutedForeground} style={[styles.nameInput, { backgroundColor: colors.card, borderColor: colors.input, color: colors.foreground }]} />
          {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
        </View>
        <PrimaryButton label="Partecipa al gruppo" icon="arrow-right" onPress={() => void submit()} disabled={code.length !== 6 || !name.trim()} loading={join.isPending} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: 'space-between', paddingBottom: 20 },
  label: { fontFamily: 'Inter_700Bold', fontSize: 18, letterSpacing: -0.35, marginTop: 24 },
  hint: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, marginTop: 10 },
  codeBoxes: { flexDirection: 'row', height: 64, borderRadius: 15, borderWidth: 1, overflow: 'hidden', marginTop: 29 },
  codeCell: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  codeChar: { fontFamily: 'Inter_700Bold', fontSize: 23, letterSpacing: 0.4 },
  hiddenInput: { position: 'absolute', width: '100%', height: '100%', opacity: 0 },
  nameInput: { height: 56, borderWidth: 1, borderRadius: 15, paddingHorizontal: 16, fontFamily: 'Inter_400Regular', fontSize: 17, marginTop: 12 },
  error: { fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 10 },
});