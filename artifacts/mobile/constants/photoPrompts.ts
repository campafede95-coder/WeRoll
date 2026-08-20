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

const promptByReminderKey = new Map<string, string | null>();
let lastPrompt: string | null = null;

function choosePhotoPrompt() {
  if (Math.random() >= PHOTO_PROMPT_PROBABILITY) {
    return null;
  }

  const availablePrompts = PHOTO_PROMPTS.filter((prompt) => prompt !== lastPrompt);
  const prompt = availablePrompts[Math.floor(Math.random() * availablePrompts.length)] ?? PHOTO_PROMPTS[0];
  lastPrompt = prompt;
  return prompt;
}

export function getPhotoPromptForReminder(reminderKey: string) {
  if (!reminderKey) return null;

  if (!promptByReminderKey.has(reminderKey)) {
    promptByReminderKey.set(reminderKey, choosePhotoPrompt());
  }

  return promptByReminderKey.get(reminderKey) ?? null;
}