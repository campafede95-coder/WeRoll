import React, { useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import { getGetExperienceQueryKey, useCreateMemory, useGetExperience } from '@workspace/api-client-react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Screen, PrimaryButton } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';

export default function CaptureScreen() {
  const colors = useColors();
  const router = useRouter();
  const { id, test } = useLocalSearchParams<{ id: string; test?: string }>();
  const isTest = test === 'true';
  const queryClient = useQueryClient();
  const experience = useGetExperience(id, { query: { queryKey: getGetExperienceQueryKey(id), enabled: Boolean(id) } }).data;
  const mutation = useCreateMemory();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [permission, requestPermission] = ImagePicker.useCameraPermissions();
  const capture = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted && !result.canAskAgain) Alert.alert('Fotocamera non disponibile', 'Abilita l’accesso alla fotocamera dalle impostazioni.', [{ text: 'Apri impostazioni', onPress: () => void Linking.openSettings() }, { text: 'Annulla', style: 'cancel' }]);
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.35, allowsEditing: false, base64: true });
    if (!result.canceled) { const asset = result.assets[0]; setImageUri(asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri); void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }
  };
  const gallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.35, allowsEditing: false, base64: true });
    if (!result.canceled) { const asset = result.assets[0]; setImageUri(asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri); }
  };
  const save = () => {
    if (!id || !imageUri) return;
    mutation.mutate({ experienceId: id, data: { imageUri, capturedAt: new Date().toISOString() } }, { onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getGetExperienceQueryKey(id) }); router.replace(`/experience/${id}` as never); }, onError: () => Alert.alert('Foto non salvata', 'Conserva lo scatto e riprova tra un momento.') });
  };
  return <View style={[styles.page, { backgroundColor: colors.foreground }]}><View style={styles.top}><Pressable accessibilityRole="button" accessibilityLabel="Chiudi fotocamera" onPress={() => router.back()}><Feather name="x" size={25} color={colors.primaryForeground} /></Pressable><View style={styles.topCenter}><Text style={[styles.kicker, { color: colors.accent }]}>{isTest ? 'SCATTO DI PROVA' : 'NUOVO RICORDO'}</Text><Text style={[styles.topTitle, { color: colors.primaryForeground }]}>{experience?.name || 'Esperienza'}</Text></View><View style={{ width: 25 }} /></View><View style={styles.preview}>{imageUri ? <Image source={{ uri: imageUri }} contentFit={isTest ? 'contain' : 'cover'} style={StyleSheet.absoluteFillObject} /> : <View style={[styles.emptyPreview, { backgroundColor: colors.card }]}><Feather name="camera" size={37} color={colors.primary} /><Text style={[styles.previewTitle, { color: colors.foreground }]}>{isTest ? 'Controlla l’inquadratura' : 'Fermate il momento'}</Text><Text style={[styles.previewBody, { color: colors.mutedForeground }]}>{isTest ? 'Lo scatto non entrerà nell’album.' : 'La foto entrerà nell’album di tutti.'}</Text></View>}</View><View style={styles.bottom}><View style={styles.tools}><Pressable accessibilityRole="button" accessibilityLabel="Scegli dalla galleria" onPress={gallery} style={styles.tool}><Feather name="image" size={22} color={colors.primaryForeground} /><Text style={[styles.toolLabel, { color: colors.primaryForeground }]}>Galleria</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Scatta foto" onPress={capture} style={[styles.shutter, { borderColor: colors.primaryForeground }]}><View style={[styles.shutterInner, { backgroundColor: colors.primary }]} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Ripeti scatto" onPress={() => setImageUri(null)} style={styles.tool}><Feather name="rotate-ccw" size={22} color={colors.primaryForeground} /><Text style={[styles.toolLabel, { color: colors.primaryForeground }]}>Ripeti</Text></Pressable></View>{imageUri ? <PrimaryButton label={isTest ? 'Chiudi prova' : "Aggiungi all'album"} icon={isTest ? 'x' : 'check'} onPress={isTest ? () => router.back() : save} loading={!isTest && mutation.isPending} style={{ marginTop: 20 }} /> : null}</View></View>;
}

const styles = StyleSheet.create({ page: { flex: 1, paddingHorizontal: 18 }, top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 54, paddingBottom: 20 }, topCenter: { alignItems: 'center' }, kicker: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.7 }, topTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, marginTop: 4 }, preview: { flex: 1, overflow: 'hidden', borderRadius: 27 }, emptyPreview: { flex: 1, alignItems: 'center', justifyContent: 'center' }, previewTitle: { fontFamily: 'Inter_700Bold', fontSize: 21, marginTop: 15 }, previewBody: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 6 }, bottom: { paddingTop: 20, paddingBottom: 28 }, tools: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' }, tool: { alignItems: 'center', gap: 7, minWidth: 68 }, toolLabel: { fontFamily: 'Inter_500Medium', fontSize: 12 }, shutter: { width: 74, height: 74, borderRadius: 37, borderWidth: 4, alignItems: 'center', justifyContent: 'center' }, shutterInner: { width: 60, height: 60, borderRadius: 30 } });