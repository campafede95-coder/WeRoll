import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { fetch as expoFetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import { useQueryClient } from '@tanstack/react-query';
import { getGetExperienceQueryKey, useGetExperience } from '@workspace/api-client-react';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, Alert, BackHandler, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, PrimaryButton } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';
import { LAST_EXPERIENCE_ID_STORAGE_KEY, resolveExperienceId } from '@/constants/experience';
import { authorizeExperienceReturn, isExperienceReturnAuthorized } from '@/constants/experienceNavigation';

const SAVE_TIMEOUT_MS = 45_000;
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, '');

export default function CaptureScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const returnInProgress = useRef(false);
  const { id, experienceId: experienceIdParam, test, autoCamera, reminderId } = useLocalSearchParams<{ id: string; experienceId?: string; test?: string; autoCamera?: string; reminderId?: string }>();
  const isTest = test === 'true';
  const [storedExperienceId, setStoredExperienceId] = useState('');
  const experienceId = resolveExperienceId(experienceIdParam, id, storedExperienceId);
  const queryClient = useQueryClient();
  const experience = useGetExperience(experienceId, { query: { queryKey: getGetExperienceQueryKey(experienceId), enabled: Boolean(experienceId) } }).data;
  const saveControllerRef = useRef<AbortController | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState('image/jpeg');
  const [isSaving, setIsSaving] = useState(false);
  const [permission, requestPermission] = ImagePicker.useCameraPermissions();
  const [mediaLibraryPermission, requestMediaLibraryPermission] = MediaLibrary.usePermissions({ writeOnly: true });
  const shouldAutoOpenCamera = autoCamera === 'true' && Platform.OS !== 'web';
  const [openingCamera, setOpeningCamera] = useState(shouldAutoOpenCamera);
  const autoCameraOpened = useRef(false);
  useEffect(() => {
    if (experienceId) {
      void AsyncStorage.setItem(LAST_EXPERIENCE_ID_STORAGE_KEY, experienceId);
      return;
    }
    void AsyncStorage.getItem(LAST_EXPERIENCE_ID_STORAGE_KEY).then((value) => setStoredExperienceId(resolveExperienceId(value)));
  }, [experienceId]);
  const saveCameraPhotoToLibrary = async (uri: string) => {
    if (Platform.OS === 'web') return;
    const currentPermission = mediaLibraryPermission?.granted
      ? mediaLibraryPermission
      : await requestMediaLibraryPermission();
    if (!currentPermission.granted) {
      Alert.alert('Foto non salvata in galleria', 'Puoi autorizzare l’accesso alle foto dalle impostazioni. Lo scatto resta disponibile per l’album condiviso.');
      return;
    }
    try {
      await MediaLibrary.saveToLibraryAsync(uri);
    } catch (error) {
      console.warn('Salvataggio nella galleria fallito.', error);
      Alert.alert('Foto non salvata in galleria', 'Lo scatto resta disponibile per l’album condiviso.');
    }
  };
  const capture = async (automatic = false) => {
    if (automatic) setOpeningCamera(true);
    try {
      if (!permission?.granted) {
        const result = await requestPermission();
        if (!result.granted) {
          Alert.alert(
            result.canAskAgain ? 'Fotocamera non abilitata' : 'Fotocamera non disponibile',
            'Abilita l’accesso alla fotocamera dalle impostazioni per effettuare lo scatto.',
            [{ text: 'Apri impostazioni', onPress: () => void Linking.openSettings() }, { text: 'Annulla', style: 'cancel' }],
          );
          return;
        }
      }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, allowsEditing: false });
      if (!result.canceled) {
        const asset = result.assets[0];
        setImageUri(asset.uri);
        setImageMimeType(asset.mimeType || 'image/jpeg');
        void saveCameraPhotoToLibrary(asset.uri);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } finally {
      if (automatic) setOpeningCamera(false);
    }
  };
  useEffect(() => {
    if (!shouldAutoOpenCamera || autoCameraOpened.current || !permission) return;
    autoCameraOpened.current = true;
    void capture(true);
  }, [permission, shouldAutoOpenCamera]);
  const saveErrorMessage = (error: unknown) => {
    const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : undefined;
    if (status === 404) return 'Questo gruppo non è più disponibile. Torna alla sessione e riprova.';
    if (status === 403) return 'Non fai più parte di questo gruppo. Riapri l’invito e riprova.';
    if (status === 413) return 'La foto è troppo grande per essere inviata. Prova a rifarla.';
    if (status && status >= 500) return 'Il server non riesce a salvare la foto in questo momento. Riprova tra poco.';
    return 'Controlla la connessione e riprova. La foto resta visibile in questa schermata.';
  };
  const gallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsEditing: false });
    if (!result.canceled) {
      const asset = result.assets[0];
      setImageUri(asset.uri);
      setImageMimeType(asset.mimeType || 'image/jpeg');
    }
  };
  const returnToSession = useCallback(() => {
    if (!experienceId || returnInProgress.current) {
      if (!experienceId) {
        Alert.alert('Gruppo non disponibile', 'Riapri la sessione e prova di nuovo. La foto resta qui e non viene persa.');
      }
      return;
    }
    returnInProgress.current = true;
    saveControllerRef.current?.abort();
    authorizeExperienceReturn(experienceId);
    router.dismissTo({ pathname: '/experience/[id]', params: { id: experienceId, experienceId } });
    setTimeout(() => {
      returnInProgress.current = false;
    }, 1000);
  }, [experienceId, router]);
  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (!experienceId || isExperienceReturnAuthorized(experienceId)) return;
    event.preventDefault();
    returnToSession();
  }), [experienceId, navigation, returnToSession]);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!experienceId) {
      Alert.alert('Gruppo non disponibile', 'Riapri la sessione e prova di nuovo. La foto resta qui e non viene persa.');
        return true;
      }
      returnToSession();
      return true;
    });
    return () => subscription.remove();
  }, [returnToSession]);
  const save = async () => {
    if (!imageUri) {
      Alert.alert('Foto non disponibile', 'Scatta o scegli di nuovo una foto prima di aggiungerla all’album.');
      return;
    }
    if (!experienceId) {
      Alert.alert('Gruppo non disponibile', 'Riapri la sessione e prova di nuovo. La foto resta qui e non viene persa.');
      return;
    }
    setIsSaving(true);
    const controller = new AbortController();
    saveControllerRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {
        'Content-Type': imageMimeType,
        'x-captured-at': new Date().toISOString(),
      };
      if (reminderId) headers['x-reminder-id'] = reminderId;
      const guestId = (await AsyncStorage.getItem('pic-sync-guest-id'))?.trim();
      const guestName = (await AsyncStorage.getItem('pic-sync-guest-name'))?.trim();
      if (!API_BASE_URL || !guestId) throw new Error('Configurazione upload non disponibile.');
      headers['x-pic-sync-guest-id'] = guestId;
      if (guestName) headers['x-pic-sync-guest-name'] = guestName;

      const response = await expoFetch(
        `${API_BASE_URL}/api/experiences/${encodeURIComponent(experienceId)}/memories`,
        {
          method: 'POST',
          headers,
          body: new File(imageUri),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: unknown } | null;
        const error = new Error(typeof payload?.error === 'string' ? payload.error : `Upload fallito (${response.status})`) as Error & { status: number };
        error.status = response.status;
        throw error;
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void queryClient.invalidateQueries({ queryKey: getGetExperienceQueryKey(experienceId) });
      returnToSession();
    } catch (error) {
      console.warn('Salvataggio foto fallito.', error);
      Alert.alert(
        controller.signal.aborted ? 'Salvataggio troppo lento' : 'Foto non salvata',
        controller.signal.aborted ? 'Il telefono non è riuscito a raggiungere il server in tempo. Controlla la connessione e riprova: la foto resta qui.' : saveErrorMessage(error),
      );
    } finally {
      clearTimeout(timeout);
      if (saveControllerRef.current === controller) saveControllerRef.current = null;
      setIsSaving(false);
    }
  };
  if (openingCamera && !imageUri) {
    return <View style={[styles.openingPage, { backgroundColor: colors.foreground }]}><ActivityIndicator size="large" color={colors.primary} /><Text style={[styles.openingText, { color: colors.primaryForeground }]}>Apertura fotocamera…</Text></View>;
  }
  return <View style={[styles.page, { backgroundColor: colors.foreground }]}><View style={[styles.top, { paddingTop: Math.max(54, insets.top) }]}><Pressable accessibilityRole="button" accessibilityLabel="Chiudi fotocamera" onPress={returnToSession}><Feather name="x" size={25} color={colors.primaryForeground} /></Pressable><View style={styles.topCenter}><Text style={[styles.kicker, { color: colors.accent }]}>{isTest ? 'SCATTO DI PROVA' : 'NUOVO RICORDO'}</Text><Text style={[styles.topTitle, { color: colors.primaryForeground }]}>{experience?.name || 'Esperienza'}</Text></View><View style={{ width: 25 }} /></View><View style={styles.preview}>{imageUri ? <Image source={{ uri: imageUri }} contentFit={isTest ? 'contain' : 'cover'} style={StyleSheet.absoluteFillObject} /> : <View style={[styles.emptyPreview, { backgroundColor: colors.card }]}><Feather name="camera" size={37} color={colors.primary} /><Text style={[styles.previewTitle, { color: colors.foreground }]}>{isTest ? 'Controlla l’inquadratura' : 'Fermate il momento'}</Text><Text style={[styles.previewBody, { color: colors.mutedForeground }]}>{isTest ? 'Lo scatto non entrerà nell’album.' : 'La foto entrerà nell’album di tutti.'}</Text></View>}</View><View style={[styles.bottom, { paddingBottom: Math.max(28, insets.bottom) }]}><View style={styles.tools}><Pressable accessibilityRole="button" accessibilityLabel="Scegli dalla galleria" onPress={gallery} style={styles.tool}><Feather name="image" size={22} color={colors.primaryForeground} /><Text style={[styles.toolLabel, { color: colors.primaryForeground }]}>Galleria</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Scatta foto" onPress={() => void capture()} style={[styles.shutter, { borderColor: colors.primaryForeground }]}><View style={[styles.shutterInner, { backgroundColor: colors.primary }]} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Ripeti scatto" onPress={() => setImageUri(null)} style={styles.tool}><Feather name="rotate-ccw" size={22} color={colors.primaryForeground} /><Text style={[styles.toolLabel, { color: colors.primaryForeground }]}>Ripeti</Text></Pressable></View>{imageUri ? <><PrimaryButton label={isTest ? 'Chiudi prova' : "Aggiungi all'album"} icon={isTest ? 'x' : 'check'} onPress={isTest ? returnToSession : () => void save()} loading={!isTest && isSaving} style={{ marginTop: 20 }} />{isSaving ? <Text style={[styles.savingText, { color: colors.primaryForeground }]}>Caricamento foto originale in corso…</Text> : null}</> : null}</View></View>;
}

const styles = StyleSheet.create({ page: { flex: 1, paddingHorizontal: 18 }, openingPage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }, openingText: { fontFamily: 'Inter_500Medium', fontSize: 15 }, top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 54, paddingBottom: 20 }, topCenter: { alignItems: 'center' }, kicker: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.7 }, topTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, marginTop: 4 }, preview: { flex: 1, overflow: 'hidden', borderRadius: 27 }, emptyPreview: { flex: 1, alignItems: 'center', justifyContent: 'center' }, previewTitle: { fontFamily: 'Inter_700Bold', fontSize: 21, marginTop: 15 }, previewBody: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 6 }, bottom: { paddingTop: 20, paddingBottom: 28 }, tools: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' }, tool: { alignItems: 'center', gap: 7, minWidth: 68 }, toolLabel: { fontFamily: 'Inter_500Medium', fontSize: 12 }, shutter: { width: 74, height: 74, borderRadius: 37, borderWidth: 4, alignItems: 'center', justifyContent: 'center' }, shutterInner: { width: 60, height: 60, borderRadius: 30 }, savingText: { textAlign: 'center', fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 10 } });