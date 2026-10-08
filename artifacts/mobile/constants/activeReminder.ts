import AsyncStorage from '@react-native-async-storage/async-storage';

export const ACTIVE_REMINDER_STORAGE_KEY = 'pic-sync-active-moment';

export type ActiveReminder = {
  experienceId: string;
  reminderId?: string;
  scheduledAt: string;
  isTest?: boolean;
  notificationId?: string;
};

function isActiveReminder(value: unknown): value is ActiveReminder {
  if (!value || typeof value !== 'object') return false;
  const reminder = value as Record<string, unknown>;
  return typeof reminder.experienceId === 'string' && typeof reminder.scheduledAt === 'string';
}

export async function saveActiveReminder(reminder: ActiveReminder) {
  await AsyncStorage.setItem(ACTIVE_REMINDER_STORAGE_KEY, JSON.stringify(reminder));
}

export async function loadActiveReminder(): Promise<ActiveReminder | null> {
  try {
    const stored = await AsyncStorage.getItem(ACTIVE_REMINDER_STORAGE_KEY);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    return isActiveReminder(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function clearActiveReminder() {
  await AsyncStorage.removeItem(ACTIVE_REMINDER_STORAGE_KEY);
}