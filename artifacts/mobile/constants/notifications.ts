import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export const PHOTO_REMINDER_CHANNEL = 'pic-sync-reminders-v2';
export const PHOTO_REMINDER_SOUND = 'photo-reminder.mp3';

export async function ensurePhotoReminderChannel() {
  if (Platform.OS !== 'android') return null;

  return Notifications.setNotificationChannelAsync(PHOTO_REMINDER_CHANNEL, {
    name: 'Promemoria foto',
    description: 'Sveglie brevi per i momenti fotografici del gruppo',
    importance: Notifications.AndroidImportance.HIGH,
    sound: PHOTO_REMINDER_SOUND,
    enableVibrate: true,
    vibrationPattern: [0, 250, 140, 250],
  });
}