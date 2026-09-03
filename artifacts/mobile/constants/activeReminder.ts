import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

export const ACTIVE_REMINDER_STORAGE_KEY = 'pic-sync-active-moment';
export const PHOTO_WINDOW_MS = 15 * 60 * 1000;

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

let activeReminder: ActiveReminder | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return activeReminder;
}

export function activateReminder(value: unknown): ActiveReminder | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (typeof data.experienceId !== 'string' || typeof data.reminderId !== 'string' || typeof data.scheduledAt !== 'string') return null;

  const scheduledAtMs = new Date(data.scheduledAt).getTime();
  if (!Number.isFinite(scheduledAtMs) || scheduledAtMs + PHOTO_WINDOW_MS <= Date.now()) return null;

  activeReminder = { experienceId: data.experienceId, reminderId: data.reminderId, scheduledAt: new Date(scheduledAtMs).toISOString() };
  notify();
  return activeReminder;
}

export function useActiveReminder(experienceId: string) {
  const reminder = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!reminder || reminder.experienceId !== experienceId) return null;
  return new Date(reminder.scheduledAt).getTime() + PHOTO_WINDOW_MS > Date.now() ? reminder : null;
}
