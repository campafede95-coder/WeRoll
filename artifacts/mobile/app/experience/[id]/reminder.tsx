import React, { useState } from 'react';
import * as Notifications from 'expo-notifications';
import { useQueryClient } from '@tanstack/react-query';
import { getGetExperienceQueryKey, useCreateReminder } from '@workspace/api-client-react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, StyleSheet, Text } from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { AppHeader, Field, PrimaryButton } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';

export default function CreateReminder() {
  const colors = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const mutation = useCreateReminder();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [scheduledAt, setScheduledAt] = useState(new Date(Date.now() + 3600000).toISOString());
  const submit = () => {
    if (!title.trim() || !id) return;
    mutation.mutate({ experienceId: id, data: { title: title.trim(), message: message.trim() || null, scheduledAt: new Date(scheduledAt).toISOString() } }, {
      onSuccess: async (reminder) => {
        try { const permission = await Notifications.getPermissionsAsync(); if (permission.granted) await Notifications.scheduleNotificationAsync({ content: { title: reminder.title, body: reminder.message || 'È il momento di catturare qualcosa insieme.' }, trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(reminder.scheduledAt) } }); } catch { /* local notifications are best effort */ }
        void queryClient.invalidateQueries({ queryKey: getGetExperienceQueryKey(id) }); router.back();
      },
      onError: () => Alert.alert('Promemoria non salvato', 'Riprova tra un momento.'),
    });
  };
  return <KeyboardAwareScrollViewCompat contentContainerStyle={[styles.page, { backgroundColor: colors.background }]}><AppHeader title="Nuovo promemoria" back /><Text style={[styles.title, { color: colors.foreground }]}>Datevi un piccolo{'\n'}segnale.</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>Un invito leggero a guardarvi intorno e tenere il momento.</Text><Field label="Titolo" value={title} onChangeText={setTitle} placeholder="La luce di fine giornata" autoFocus /><Field label="Messaggio" value={message} onChangeText={setMessage} placeholder="Fermiamoci un minuto e scattiamo" multiline style={styles.multiline} /><Field label="Quando" value={scheduledAt} onChangeText={setScheduledAt} placeholder="2025-06-20T18:30:00" hint="Formato: AAAA-MM-GGTHH:MM:SS" /><PrimaryButton label="Salva promemoria" icon="bell" onPress={submit} loading={mutation.isPending} disabled={!title.trim()} /></KeyboardAwareScrollViewCompat>;
}

const styles = StyleSheet.create({ page: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 34 }, title: { fontFamily: 'Inter_700Bold', fontSize: 31, lineHeight: 35, letterSpacing: -1, marginTop: 12 }, body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, marginTop: 9, marginBottom: 28 }, multiline: { minHeight: 88, paddingTop: 15, textAlignVertical: 'top' } });