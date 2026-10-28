import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

const API_URL = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/$/, '');
const CREDENTIAL_STORAGE_KEY = `weroll.web-push-test-credential:${API_URL || 'unconfigured'}`;

type VapidResponse = { publicKey?: unknown };
type RegisterResponse = { registered?: unknown; deviceCredential?: unknown; error?: unknown; correlationId?: unknown };
type TestResponse = { accepted?: unknown; error?: unknown; correlationId?: unknown };
type UiStatus = { kind: 'info' | 'success' | 'error'; text: string } | null;
type DiagnosticEntry = { at: string; phase: string; result: 'ok' | 'error' | 'info'; message: string; httpStatus?: number; correlationId?: string };

async function fetchApi(url: string, init?: RequestInit) {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error('API backend irraggiungibile. Verifica la connessione e la configurazione del frontend.');
  }
}

function decodeVapidKey(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = globalThis.atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isInstalledPwa() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function errorFromResponse(status: number, body: RegisterResponse | TestResponse) {
  const ref = typeof body.correlationId === 'string' ? ` (riferimento ${body.correlationId})` : '';
  const code = typeof body.error === 'string' ? body.error : '';
  if (status === 401 || code === 'DEVICE_CREDENTIAL_INVALID') return `Credenziale di questo dispositivo non valida. Disattiva e riattiva le notifiche.${ref}`;
  if (status === 409 || code === 'SUBSCRIPTION_ALREADY_REGISTERED') return `Questa subscription è già registrata ma la credenziale locale non è disponibile. Non è stata sovrascritta.${ref}`;
  if (status === 410 || code === 'SUBSCRIPTION_EXPIRED') return `La subscription è scaduta o non è più valida. Riattiva le notifiche da questo dispositivo.${ref}`;
  if (status === 429 || code === 'TEST_RATE_LIMITED') return `Attendi alcuni secondi prima di inviare un altro test.${ref}`;
  if (status === 503 || code === 'VAPID_NOT_CONFIGURED') return `Il backend non ha una configurazione Web Push valida.${ref}`;
  if (status >= 500) return `Errore del backend Web Push (HTTP ${status}).${ref}`;
  return `La richiesta Web Push non è stata accettata (HTTP ${status}).${ref}`;
}

export function WebPushControls() {
  const colors = useColors();
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const publicKeyRef = useRef<string | null>(null);
  const subscriptionRef = useRef<PushSubscription | null>(null);
  const credentialRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<UiStatus>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticEntry[]>([]);
  const addDiagnostic = useRef<(entry: Omit<DiagnosticEntry, 'at'>) => void>(() => undefined);
  addDiagnostic.current = (entry) => {
    setDiagnostics((current) => [...current, { ...entry, at: new Date().toLocaleTimeString() }].slice(-10));
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let cancelled = false;
    const prepare = async () => {
      if (!API_URL) throw new Error('EXPO_PUBLIC_API_URL non è configurata nella build web.');
      if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
        throw new Error('Questo browser non supporta Web Push oppure la pagina non è HTTPS.');
      }
      if (isIosDevice() && !isInstalledPwa()) {
        throw new Error('Su iPhone/iPad installa WeRoll sulla schermata Home e riaprila da lì per attivare le notifiche.');
      }

      const [registration, keyResponse] = await Promise.all([
        navigator.serviceWorker.register('/service-worker.js', { scope: '/' }),
        fetchApi(`${API_URL}/api/web-push/vapid-public-key`, { method: 'GET' }),
      ]);
      addDiagnostic.current({ phase: 'service worker', result: 'ok', message: `Registrato con scope ${registration.scope}` });
      await navigator.serviceWorker.ready;
      addDiagnostic.current({ phase: 'service worker', result: 'ok', message: 'Worker attivo' });
      const keyCorrelationId = keyResponse.headers.get('x-correlation-id') ?? undefined;
      addDiagnostic.current({ phase: 'chiave VAPID', result: keyResponse.ok ? 'ok' : 'error', message: keyResponse.ok ? 'Chiave pubblica disponibile' : 'Il backend non ha restituito la chiave pubblica', httpStatus: keyResponse.status, correlationId: keyCorrelationId });
      if (!keyResponse.ok) {
        const body = await keyResponse.json().catch(() => ({})) as RegisterResponse;
        throw new Error(errorFromResponse(keyResponse.status, body));
      }
      const body = await keyResponse.json() as VapidResponse;
      if (typeof body.publicKey !== 'string' || !body.publicKey) throw new Error('La chiave pubblica VAPID non è disponibile.');
      const existingSubscription = await registration.pushManager.getSubscription();
      const savedCredential = await AsyncStorage.getItem(CREDENTIAL_STORAGE_KEY);
      if (cancelled) return;
      registrationRef.current = registration;
      publicKeyRef.current = body.publicKey;
      subscriptionRef.current = existingSubscription;
      credentialRef.current = savedCredential;
      setRegistered(Boolean(existingSubscription && savedCredential));
      setReady(true);
      setStatus({ kind: 'info', text: existingSubscription
        ? 'Service worker attivo. Subscription già presente su questo browser.'
        : 'Service worker pronto. Premi “Attiva notifiche web” per autorizzare e registrare questo dispositivo.' });
      addDiagnostic.current({ phase: 'subscription locale', result: 'info', message: existingSubscription ? 'Subscription esistente rilevata' : 'Nessuna subscription esistente' });
    };

    void prepare().catch((error: unknown) => {
      if (cancelled) return;
      setReady(false);
      const message = error instanceof Error ? error.message : 'Impossibile preparare Web Push.';
      addDiagnostic.current({ phase: 'preparazione', result: 'error', message });
      setStatus({ kind: 'error', text: message });
    });
    return () => { cancelled = true; };
  }, []);

  const activate = () => {
    if (Platform.OS !== 'web' || busy) return;
    if (!ready || !registrationRef.current || !publicKeyRef.current) {
      addDiagnostic.current({ phase: 'precondizioni', result: 'error', message: 'Service worker o chiave VAPID non pronti' });
      setStatus({ kind: 'error', text: 'Web Push non è pronto: controlla service worker, connessione API e chiave VAPID.' });
      return;
    }
    if (Notification.permission === 'denied') {
      addDiagnostic.current({ phase: 'permesso', result: 'error', message: 'Permesso già negato nelle impostazioni del browser' });
      setStatus({ kind: 'error', text: 'Permesso notifiche negato. Abilitalo nelle impostazioni del browser/iPhone e riprova.' });
      return;
    }

    // Keep the permission request directly in the click handler, before any await or network call.
    const permissionRequest = Notification.permission === 'granted'
      ? Promise.resolve<NotificationPermission>('granted')
      : Notification.requestPermission();
    addDiagnostic.current({ phase: 'permesso', result: 'info', message: 'Richiesta avviata dal gesto del pulsante' });
    setBusy(true);
    setStatus({ kind: 'info', text: 'Richiesta di autorizzazione notifiche…' });
    void permissionRequest.then(async (permission) => {
      if (permission !== 'granted') {
        addDiagnostic.current({ phase: 'permesso', result: 'error', message: 'Permesso non concesso; nessuna subscription modificata' });
        setStatus({ kind: 'error', text: 'Permesso notifiche non concesso. Non è stata creata o modificata alcuna subscription.' });
        return;
      }
      addDiagnostic.current({ phase: 'permesso', result: 'ok', message: 'Permesso notifiche concesso' });
      setStatus({ kind: 'info', text: 'Permesso concesso. Registrazione Web Push del dispositivo in corso…' });
      try {
        const registration = registrationRef.current;
        const publicKey = publicKeyRef.current;
        if (!registration || !publicKey) throw new Error('Registrazione service worker o chiave VAPID non disponibile.');
        // Reuse a valid subscription. If none exists, subscribe immediately after permission.
        addDiagnostic.current({ phase: 'subscription', result: 'info', message: subscriptionRef.current ? 'Riutilizzo subscription esistente' : 'Creazione subscription con chiave VAPID' });
        const subscription = subscriptionRef.current ?? await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidKey(publicKey),
        });
        subscriptionRef.current = subscription;
        const authorization = credentialRef.current;
        const response = await fetchApi(`${API_URL}/api/web-push/subscriptions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}),
          },
          body: JSON.stringify(subscription.toJSON()),
        });
        const body = await response.json().catch(() => ({})) as RegisterResponse;
        addDiagnostic.current({ phase: 'registrazione backend', result: response.ok ? 'ok' : 'error', message: response.ok ? 'Subscription registrata per questo dispositivo' : 'Il backend ha rifiutato la subscription', httpStatus: response.status, correlationId: typeof body.correlationId === 'string' ? body.correlationId : response.headers.get('x-correlation-id') ?? undefined });
        if (!response.ok) throw new Error(errorFromResponse(response.status, body));
        if (typeof body.deviceCredential === 'string') {
          await AsyncStorage.setItem(CREDENTIAL_STORAGE_KEY, body.deviceCredential);
          credentialRef.current = body.deviceCredential;
        }
        if (!credentialRef.current) throw new Error('Il server non ha restituito una credenziale per questo dispositivo.');
        setRegistered(true);
        setStatus({ kind: 'success', text: 'Notifiche attivate e subscription registrata per questo dispositivo.' });
      } catch (error) {
        const message = `Permesso concesso, ma la registrazione Web Push non è completata: ${error instanceof Error ? error.message : 'errore imprevisto'}`;
        addDiagnostic.current({ phase: 'registrazione backend', result: 'error', message });
        setStatus({ kind: 'error', text: message });
      }
    }).catch(() => {
      addDiagnostic.current({ phase: 'permesso', result: 'error', message: 'Il browser non ha completato la richiesta di permesso' });
      setStatus({ kind: 'error', text: 'Permesso concesso, ma il browser non ha completato l’attivazione Web Push.' });
    }).finally(() => setBusy(false));
  };

  const sendTest = async () => {
    if (!API_URL || !credentialRef.current || busy) return;
    setBusy(true);
    setStatus({ kind: 'info', text: 'Invio della prova alla sola subscription di questo dispositivo…' });
    try {
      const response = await fetchApi(`${API_URL}/api/web-push/subscriptions/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${credentialRef.current}` },
      });
      const body = await response.json().catch(() => ({})) as TestResponse;
      addDiagnostic.current({ phase: 'invio test', result: response.ok ? 'ok' : 'error', message: response.ok ? 'Provider push ha accettato la richiesta; ricezione non confermata' : 'Invio rifiutato', httpStatus: response.status, correlationId: typeof body.correlationId === 'string' ? body.correlationId : response.headers.get('x-correlation-id') ?? undefined });
      if (!response.ok) throw new Error(errorFromResponse(response.status, body));
      const ref = typeof body.correlationId === 'string' ? ` Riferimento: ${body.correlationId}.` : '';
      setStatus({ kind: 'success', text: `Invio accettato dal provider Web Push. La ricezione sul dispositivo non è confermata: controlla le notifiche dell’iPhone.${ref}` });
    } catch (error) {
      addDiagnostic.current({ phase: 'invio test', result: 'error', message: error instanceof Error ? error.message : 'Errore durante l’invio Web Push.' });
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Errore durante l’invio Web Push.' });
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async () => {
    if (!API_URL || !credentialRef.current || busy) return;
    setBusy(true);
    try {
      const response = await fetchApi(`${API_URL}/api/web-push/subscriptions`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${credentialRef.current}` },
      });
      if (!response.ok && response.status !== 404) throw new Error(`Il backend non ha disattivato la subscription (HTTP ${response.status}).`);
      addDiagnostic.current({ phase: 'disattivazione', result: 'ok', message: 'Subscription rimossa dal backend', httpStatus: response.status, correlationId: response.headers.get('x-correlation-id') ?? undefined });
      await subscriptionRef.current?.unsubscribe();
      await AsyncStorage.removeItem(CREDENTIAL_STORAGE_KEY);
      credentialRef.current = null;
      subscriptionRef.current = null;
      setRegistered(false);
      setStatus({ kind: 'success', text: 'Subscription Web Push rimossa da questo dispositivo.' });
    } catch (error) {
      addDiagnostic.current({ phase: 'disattivazione', result: 'error', message: error instanceof Error ? error.message : 'Non è stato possibile disattivare Web Push.' });
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Non è stato possibile disattivare Web Push.' });
    } finally {
      setBusy(false);
    }
  };

  const buttonStyle = (disabled: boolean) => ({
    minHeight: 42,
    paddingHorizontal: 15,
    borderRadius: 12,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: disabled ? colors.muted : colors.primary,
    opacity: disabled ? 0.65 : 1,
  });

  return (
    <View style={{ marginTop: 20, padding: 14, gap: 12, borderRadius: 16, backgroundColor: colors.card }}>
      <View style={{ gap: 4 }}>
        <Text style={{ color: colors.foreground, fontWeight: '700', fontSize: 16 }}>Web Push su questo dispositivo</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 13, lineHeight: 18 }}>
          La prova invia una sola notifica a questo browser. Non usa Expo e non notifica gli altri partecipanti.
        </Text>
      </View>
      <Pressable accessibilityRole="button" onPress={activate} disabled={busy || !ready} style={buttonStyle(busy || !ready)}>
        <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>{registered ? 'Verifica attivazione Web Push' : 'Attiva notifiche web'}</Text>
      </Pressable>
      {registered ? (
        <>
          <Pressable accessibilityRole="button" onPress={() => void sendTest()} disabled={busy} style={buttonStyle(busy)}>
            <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>Invia test Web Push</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => void deactivate()} disabled={busy} style={{ alignItems: 'center', padding: 8 }}>
            <Text style={{ color: colors.destructive, fontWeight: '600' }}>Disattiva su questo dispositivo</Text>
          </Pressable>
        </>
      ) : null}
      {status ? (
        <Text accessibilityLiveRegion="polite" style={{ color: status.kind === 'error' ? colors.destructive : status.kind === 'success' ? colors.primary : colors.mutedForeground, fontSize: 12, lineHeight: 18 }}>
          {status.text}
        </Text>
      ) : null}
      {diagnostics.length ? (
        <View accessibilityLabel="Diagnostica Web Push" style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, gap: 5 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 11, fontWeight: '700' }}>Diagnostica locale</Text>
          {diagnostics.map((entry, index) => (
            <Text key={`${entry.at}-${entry.phase}-${index}`} style={{ color: entry.result === 'error' ? colors.destructive : colors.mutedForeground, fontSize: 10, lineHeight: 15 }}>
              {entry.at} · {entry.phase} · {entry.result.toUpperCase()}{entry.httpStatus ? ` · HTTP ${entry.httpStatus}` : ''}{entry.correlationId ? ` · ref ${entry.correlationId}` : ''} · {entry.message}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
