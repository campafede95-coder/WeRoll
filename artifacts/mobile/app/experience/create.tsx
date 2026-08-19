import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getListExperiencesQueryKey, useCreateExperience } from '@workspace/api-client-react';
import { useRouter } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { AppHeader, Field, PrimaryButton } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';

export default function CreateExperience() {
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const mutation = useCreateExperience();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const submit = () => {
    if (!name.trim()) return;
    mutation.mutate({ data: { name: name.trim(), description: description.trim() || null, location: location.trim() || null, startDate: new Date(startDate).toISOString(), endDate: new Date(endDate).toISOString() } }, {
      onSuccess: (experience) => { void queryClient.invalidateQueries({ queryKey: getListExperiencesQueryKey() }); router.replace(`/experience/${experience.id}` as never); },
      onError: () => Alert.alert('Non è stato possibile creare l’esperienza', 'Riprova tra un momento.'),
    });
  };
  return (
    <KeyboardAwareScrollViewCompat contentContainerStyle={[styles.page, { backgroundColor: colors.background }]}>
      <AppHeader title="Nuova esperienza" back />
      <View style={[styles.intro, { backgroundColor: colors.secondary }]}><Text style={[styles.introTitle, { color: colors.foreground }]}>Dove vi porta{'\n'}la prossima storia?</Text><Text style={[styles.introBody, { color: colors.mutedForeground }]}>Un nome semplice. Il resto lo aggiungerete vivendo.</Text></View>
      <Field label="Nome dell'esperienza" value={name} onChangeText={setName} placeholder="Weekend in montagna" autoFocus />
      <Field label="Descrizione" value={description} onChangeText={setDescription} placeholder="Una riga per ricordarvi il perché" multiline style={styles.multiline} />
      <Field label="Luogo" value={location} onChangeText={setLocation} placeholder="Cortina, Italia" />
      <View style={styles.dateRow}><View style={{ flex: 1 }}><Field label="Inizio" value={startDate} onChangeText={setStartDate} placeholder="2025-06-20" /></View><View style={{ flex: 1 }}><Field label="Fine" value={endDate} onChangeText={setEndDate} placeholder="2025-06-22" /></View></View>
      <PrimaryButton label="Crea esperienza" icon="arrow-right" onPress={submit} loading={mutation.isPending} disabled={!name.trim()} style={{ marginTop: 4 }} />
      <Text style={[styles.note, { color: colors.mutedForeground }]}>Potrai aggiungere foto, persone e promemoria in qualsiasi momento.</Text>
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 34 },
  intro: { borderRadius: 22, padding: 19, marginBottom: 25 },
  introTitle: { fontFamily: 'Inter_700Bold', fontSize: 23, lineHeight: 27, letterSpacing: -0.6 },
  introBody: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, marginTop: 8 },
  multiline: { minHeight: 92, paddingTop: 15, textAlignVertical: 'top' },
  dateRow: { flexDirection: 'row', gap: 11 },
  note: { textAlign: 'center', fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17, paddingHorizontal: 22, marginTop: 15 },
});