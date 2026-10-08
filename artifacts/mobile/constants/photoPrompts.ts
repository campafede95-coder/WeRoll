export const PHOTO_PROMPT_PROBABILITY = 0.3;

export const PHOTO_PROMPTS = [
  'Da provare: un grande abbraccio.',
  'Che ne dite di una foto con le mani al cielo?',
  'Perché non provate a saltare tutti insieme?',
  'Da provare: la vostra posa migliore.',
  'Che ne dite di una foto senza guardare la fotocamera?',
  'Perché non provate a fare una foto mentre ridete?',
  'Una sfida: tutti dentro l’inquadratura!',
  'Da provare: una posa un po’ folle.',
  'Che ne dite di un abbraccio di gruppo?',
  'Perché non provate a inventare una posa tutti insieme?',
  'Da provare: tutti in aria!',
  'Che ne dite di una foto completamente spontanea?',
  'Perché non provate a guardare tutti nella stessa direzione?',
  'Una sfida: la posa più assurda che riuscite a fare.',
  'Da provare: dimenticatevi della fotocamera e godetevi il momento.',
] as const;

export type PhotoPromptVariant = 'special' | 'normal';

function stableReminderBucket(reminderKey: string) {
  let hash = 2166136261;
  for (let index = 0; index < reminderKey.length; index += 1) {
    hash ^= reminderKey.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}

export function getPhotoPromptForReminder(reminderKey: string, messageVariant?: PhotoPromptVariant) {
  if (!reminderKey) return null;

  const variant = messageVariant ?? (stableReminderBucket(reminderKey) < PHOTO_PROMPT_PROBABILITY * 100 ? 'special' : 'normal');
  if (variant !== 'special') return null;

  const promptIndex = stableReminderBucket(`${reminderKey}:prompt`) % PHOTO_PROMPTS.length;
  return PHOTO_PROMPTS[promptIndex];
}