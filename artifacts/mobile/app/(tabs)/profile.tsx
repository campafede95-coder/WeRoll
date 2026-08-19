import React, { useEffect, useState } from 'react';
import { useAuth, useUser } from '@clerk/expo';
import * as Notifications from 'expo-notifications';
import { Feather } from '@expo/vector-icons';
import { Alert, Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Screen, AppHeader, Surface, PrimaryButton } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';

export default function ProfileScreen() {
  const colors = useColors();
  const { signOut } = useAuth();
  const { user } = useUser();
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [permission, setPermission] = useState<Notifications.NotificationPermissionsStatus | null>(null);
  useEffect(() => { void Notifications.getPermissionsAsync().then((value) => { setPermission(value); setNotificationsEnabled(value.granted); }).catch(() => undefined); }, []);
  const toggleNotifications = async (value: boolean) => {
    if (!value) { setNotificationsEnabled(false); return; }
    const current = permission?.granted ? permission : await Notifications.requestPermissionsAsync();
    setPermission(current);
    if (current.granted) setNotificationsEnabled(true);
    else if (!current.canAskAgain) Alert.alert('Notifiche disattivate', 'Puoi riattivarle dalle impostazioni del dispositivo.', [{ text: 'Apri impostazioni', onPress: () => void Linking.openSettings() }, { text: 'Annulla', style: 'cancel' }]);
  };
  const firstName = user?.firstName || user?.emailAddresses?.[0]?.emailAddress?.split('@')[0] || 'Viaggiatore';
  return (
    <Screen>
      <AppHeader eyebrow="IL TUO SPAZIO" title="Profilo" />
      <View style={styles.profileIntro}><View style={[styles.profileAvatar, { backgroundColor: colors.primary }]}><Text style={[styles.profileInitial, { color: colors.primaryForeground }]}>{firstName.slice(0, 1).toUpperCase()}</Text></View><View><Text style={[styles.name, { color: colors.foreground }]}>{firstName}</Text><Text style={[styles.email, { color: colors.mutedForeground }]}>{user?.emailAddresses?.[0]?.emailAddress || 'Account personale'}</Text></View></View>
      <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>PREFERENZE</Text>
      <Surface style={styles.preference}>
        <View style={[styles.settingIcon, { backgroundColor: colors.secondary }]}><Feather name="bell" size={18} color={colors.primary} /></View>
        <View style={styles.preferenceCopy}><Text style={[styles.preferenceTitle, { color: colors.foreground }]}>Promemoria fotografici</Text><Text style={[styles.preferenceBody, { color: colors.mutedForeground }]}>Ricevi un piccolo invito a catturare il momento.</Text></View>
        <Switch value={notificationsEnabled} onValueChange={toggleNotifications} trackColor={{ false: colors.muted, true: colors.primary }} thumbColor={colors.card} />
      </Surface>
      <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>ACCOUNT</Text>
      <Surface>
        <Pressable style={styles.row} onPress={() => Alert.alert('Pic Sync Collective', 'La tua memoria condivisa, un momento alla volta.')}><Feather name="info" size={19} color={colors.primary} /><Text style={[styles.rowText, { color: colors.foreground }]}>Su Pic Sync Collective</Text><Feather name="chevron-right" size={18} color={colors.mutedForeground} /></Pressable>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Pressable style={styles.row} onPress={() => Alert.alert('Privacy', 'Le tue foto restano legate alle esperienze che scegli di condividere.')}><Feather name="lock" size={19} color={colors.primary} /><Text style={[styles.rowText, { color: colors.foreground }]}>Privacy</Text><Feather name="chevron-right" size={18} color={colors.mutedForeground} /></Pressable>
      </Surface>
      <PrimaryButton label="Esci dall'account" icon="log-out" variant="quiet" onPress={() => void signOut()} style={{ marginTop: 24 }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  profileIntro: { flexDirection: 'row', alignItems: 'center', gap: 13, marginTop: 9, marginBottom: 35 },
  profileAvatar: { width: 64, height: 64, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  profileInitial: { fontFamily: 'Inter_700Bold', fontSize: 26 },
  name: { fontFamily: 'Inter_700Bold', fontSize: 20, letterSpacing: -0.4 },
  email: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 4 },
  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.5, marginBottom: 10, marginTop: 4 },
  preference: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 11, marginBottom: 27 },
  settingIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  preferenceCopy: { flex: 1 },
  preferenceTitle: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  preferenceBody: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17, marginTop: 3 },
  row: { minHeight: 53, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 14 },
  divider: { height: 1 },
});