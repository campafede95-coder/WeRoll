import React, { useState } from 'react';
import { useSignIn } from '@clerk/expo';
import { Link, useRouter } from 'expo-router';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { PrimaryButton, alpineMemory } from '@/components/AppUI';
import { Image } from 'expo-image';

export default function SignIn() {
  const colors = useColors();
  const router = useRouter();
  const { signIn, errors, fetchStatus } = useSignIn();
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState('');
  const busy = fetchStatus === 'fetching';

  const finalize = async () => {
    await signIn.finalize({ navigate: ({ decorateUrl }) => router.replace(decorateUrl('/(tabs)') as never) });
  };
  const submit = async () => {
    setNotice('');
    const result = await signIn.password({ emailAddress: emailAddress.trim(), password });
    if (result.error) { setNotice(result.error.message ?? 'Controlla email e password.'); return; }
    if (signIn.status === 'complete') await finalize();
    else if (signIn.status === 'needs_client_trust') {
      const factor = signIn.supportedSecondFactors.find((item) => item.strategy === 'email_code');
      if (factor) await signIn.mfa.sendEmailCode();
    } else setNotice('Completa il passaggio richiesto per continuare.');
  };
  const verify = async () => {
    await signIn.mfa.verifyEmailCode({ code });
    if (signIn.status === 'complete') await finalize();
  };
  const fieldError = errors?.fields?.identifier?.message || errors?.fields?.password?.message;
  if (signIn.status === 'needs_client_trust') {
    return (
      <View style={[styles.authPage, { backgroundColor: colors.background }]}>
        <View style={styles.authMark}><Feather name="shield" size={19} color={colors.primaryForeground} /></View>
        <Text style={[styles.kicker, { color: colors.primary }]}>UN ULTIMO PASSO</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>Conferma che sei tu.</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>Abbiamo inviato un codice di sicurezza al tuo indirizzo email.</Text>
        <TextInput value={code} onChangeText={setCode} keyboardType="number-pad" placeholder="Codice di verifica" placeholderTextColor={colors.mutedForeground} style={[styles.authInput, { backgroundColor: colors.card, borderColor: colors.input, color: colors.foreground }]} />
        <PrimaryButton label="Verifica e continua" icon="arrow-right" onPress={verify} loading={busy} />
        <Pressable onPress={() => signIn.mfa.sendEmailCode()} style={styles.textButton}><Text style={[styles.link, { color: colors.primary }]}>Invia un nuovo codice</Text></Pressable>
      </View>
    );
  }
  return (
    <KeyboardAwareScrollViewCompat contentContainerStyle={[styles.authPage, { backgroundColor: colors.background }]}>
      <View style={styles.authHero}>
        <Image source={alpineMemory} contentFit="cover" style={styles.authImage} />
        <View style={[styles.authImageShade, { backgroundColor: colors.foreground }]} />
        <View style={styles.authBrand}><View style={[styles.authMark, { backgroundColor: colors.accent }]}><Feather name="aperture" size={19} color={colors.foreground} /></View><Text style={[styles.brandName, { color: colors.primaryForeground }]}>pic sync</Text></View>
        <Text style={[styles.heroText, { color: colors.primaryForeground }]}>Le giornate belle{'\n'}si ricordano insieme.</Text>
      </View>
      <View style={styles.authForm}>
        <Text style={[styles.kicker, { color: colors.primary }]}>BENTORNATO</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>Entra nel tuo collettivo.</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>Le foto dei tuoi amici, nello stesso posto.</Text>
        <View style={styles.formFields}>
          <TextInput value={emailAddress} onChangeText={setEmailAddress} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholder="La tua email" placeholderTextColor={colors.mutedForeground} style={[styles.authInput, { backgroundColor: colors.card, borderColor: colors.input, color: colors.foreground }]} />
          <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="Password" placeholderTextColor={colors.mutedForeground} style={[styles.authInput, { backgroundColor: colors.card, borderColor: colors.input, color: colors.foreground }]} />
        </View>
        {fieldError || notice ? <Text style={[styles.error, { color: colors.destructive }]}>{fieldError || notice}</Text> : null}
        <PrimaryButton label="Continua" icon="arrow-right" onPress={submit} loading={busy} disabled={!emailAddress || !password} />
        <View style={styles.authFooter}><Text style={[styles.body, { color: colors.mutedForeground }]}>Non hai ancora un account?</Text><Link href={"/(auth)/sign-up" as never} style={[styles.link, { color: colors.primary }]}>Registrati</Link></View>
      </View>
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  authPage: { flexGrow: 1, paddingHorizontal: 22, paddingBottom: 34 },
  authHero: { height: 270, marginHorizontal: -22, overflow: 'hidden', justifyContent: 'flex-end', padding: 22 },
  authImage: { ...StyleSheet.absoluteFillObject },
  authImageShade: { ...StyleSheet.absoluteFillObject, opacity: 0.34 },
  authBrand: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 22 },
  brandName: { fontFamily: 'Inter_700Bold', fontSize: 18, letterSpacing: -0.5 },
  authMark: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  heroText: { fontSize: 32, lineHeight: 35, fontFamily: 'Inter_700Bold', letterSpacing: -1.2 },
  authForm: { paddingTop: 31 },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.8, marginBottom: 9 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 30, letterSpacing: -1.1, lineHeight: 34 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, marginTop: 8 },
  formFields: { gap: 11, marginTop: 26 },
  authInput: { height: 56, borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, fontFamily: 'Inter_400Regular', fontSize: 15 },
  error: { fontFamily: 'Inter_500Medium', fontSize: 13, marginVertical: 11 },
  authFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 23 },
  link: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  textButton: { alignItems: 'center', marginTop: 18 },
});