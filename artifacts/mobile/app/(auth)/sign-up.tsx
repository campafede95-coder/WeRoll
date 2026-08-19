import React, { useState } from 'react';
import { useAuth, useSignUp } from '@clerk/expo';
import { Link, useRouter } from 'expo-router';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { PrimaryButton } from '@/components/AppUI';

export default function SignUp() {
  const colors = useColors();
  const router = useRouter();
  const { signUp, errors, fetchStatus } = useSignUp();
  const { isSignedIn } = useAuth();
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState('');
  const busy = fetchStatus === 'fetching';
  const finalize = async () => signUp.finalize({ navigate: ({ decorateUrl }) => router.replace(decorateUrl('/(tabs)') as never) });
  const submit = async () => {
    setNotice('');
    const result = await signUp.password({ emailAddress: emailAddress.trim(), password });
    if (result.error) { setNotice(result.error.message ?? 'Controlla i dati inseriti.'); return; }
    if (!result.error) await signUp.verifications.sendEmailCode();
  };
  const verify = async () => { await signUp.verifications.verifyEmailCode({ code }); if (signUp.status === 'complete') await finalize(); };
  if (isSignedIn || signUp.status === 'complete') return null;
  if (signUp.status === 'missing_requirements' && signUp.unverifiedFields.includes('email_address')) {
    return (
      <KeyboardAwareScrollViewCompat contentContainerStyle={[styles.page, { backgroundColor: colors.background }]}>
        <View style={[styles.mark, { backgroundColor: colors.accent }]}><Feather name="mail" size={19} color={colors.foreground} /></View>
        <Text style={[styles.kicker, { color: colors.primary }]}>QUASI FATTO</Text><Text style={[styles.title, { color: colors.foreground }]}>Controlla la tua posta.</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>Inserisci il codice che ti abbiamo mandato per entrare nel tuo primo collettivo.</Text>
        <TextInput value={code} onChangeText={setCode} keyboardType="number-pad" placeholder="Codice di verifica" placeholderTextColor={colors.mutedForeground} style={[styles.input, { backgroundColor: colors.card, borderColor: colors.input, color: colors.foreground }]} />
        <PrimaryButton label="Verifica email" icon="check" onPress={verify} loading={busy} />
        <Pressable onPress={() => signUp.verifications.sendEmailCode()} style={styles.resend}><Text style={[styles.link, { color: colors.primary }]}>Invia di nuovo</Text></Pressable>
      </KeyboardAwareScrollViewCompat>
    );
  }
  return (
    <KeyboardAwareScrollViewCompat contentContainerStyle={[styles.page, { backgroundColor: colors.background }]}>
      <View style={[styles.mark, { backgroundColor: colors.primary }]}><Feather name="aperture" size={19} color={colors.primaryForeground} /></View>
      <Text style={[styles.kicker, { color: colors.primary }]}>PIC SYNC COLLECTIVE</Text>
      <Text style={[styles.title, { color: colors.foreground }]}>Fate spazio{'\n'}ai momenti.</Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>Crea uno spazio condiviso per ogni fuga, anche quella improvvisata di domani.</Text>
      <View style={styles.fields}>
        <TextInput value={emailAddress} onChangeText={setEmailAddress} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholder="Email" placeholderTextColor={colors.mutedForeground} style={[styles.input, { backgroundColor: colors.card, borderColor: colors.input, color: colors.foreground }]} />
        <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="Password (almeno 8 caratteri)" placeholderTextColor={colors.mutedForeground} style={[styles.input, { backgroundColor: colors.card, borderColor: colors.input, color: colors.foreground }]} />
      </View>
      {notice || errors?.fields?.emailAddress?.message ? <Text style={[styles.error, { color: colors.destructive }]}>{notice || errors?.fields?.emailAddress?.message}</Text> : null}
      <PrimaryButton label="Crea il mio account" icon="arrow-right" onPress={submit} loading={busy} disabled={!emailAddress || password.length < 8} />
      <View style={styles.footer}><Text style={[styles.body, { color: colors.mutedForeground }]}>Hai già un account?</Text><Link href={'/(auth)/sign-in' as never} style={[styles.link, { color: colors.primary }]}>Accedi</Link></View>
      <View nativeID="clerk-captcha" />
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, paddingHorizontal: 22, paddingTop: 60, paddingBottom: 32 },
  mark: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 46 },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.8, marginBottom: 11 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 38, lineHeight: 41, letterSpacing: -1.6 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, marginTop: 12, maxWidth: 325 },
  fields: { gap: 11, marginTop: 30, marginBottom: 3 },
  input: { height: 56, borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, fontFamily: 'Inter_400Regular', fontSize: 15 },
  error: { fontFamily: 'Inter_500Medium', fontSize: 13, marginVertical: 11 },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 24 },
  link: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  resend: { alignItems: 'center', marginTop: 18 },
});