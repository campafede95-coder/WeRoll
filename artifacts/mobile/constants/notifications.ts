import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export const PHOTO_REMINDER_CHANNEL = 'pic-sync-reminders-v3';
export const PHOTO_REMINDER_SOUND = 'photo_reminder.mp3';

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

function belongsToExperience(data: Record<string, unknown> | undefined, experienceId: string) {
  return data?.experienceId === experienceId;
}

export async function clearExperienceNotifications(experienceId: string) {
  if (Platform.OS === 'web') return;

  const [scheduled, presented, lastResponse] = await Promise.all([
    Notifications.getAllScheduledNotificationsAsync().catch(() => []),
    Notifications.getPresentedNotificationsAsync().catch(() => []),
    Notifications.getLastNotificationResponseAsync().catch(() => null),
  ]);
  const cancellations = scheduled
    .filter((notification) => belongsToExperience(notification.content.data, experienceId))
    .map((notification) => Notifications.cancelScheduledNotificationAsync(notification.identifier));
  const dismissals = presented
    .filter((notification) => belongsToExperience(notification.request.content.data, experienceId))
    .map((notification) => Notifications.dismissNotificationAsync(notification.request.identifier));

  await Promise.allSettled([...cancellations, ...dismissals]);
  if (lastResponse && belongsToExperience(lastResponse.notification.request.content.data, experienceId)) {
    await Notifications.clearLastNotificationResponseAsync();
  }
}