import AsyncStorage from '@react-native-async-storage/async-storage';

export const LAST_EXPERIENCE_ID_STORAGE_KEY = 'pic-sync-last-experience-id';
export const CLOSED_EXPERIENCES_STORAGE_KEY = 'pic-sync-closed-experiences';

const EXPERIENCE_ID_PATTERN = /^\d+-[a-z0-9]+$/i;
let closedExperiencesCache: Set<string> | null = null;
let closedExperiencesLoadPromise: Promise<Set<string>> | null = null;

export function resolveExperienceId(...values: Array<string | string[] | undefined | null>) {
  for (const value of values) {
    const candidate = Array.isArray(value) ? value[0] : value;
    if (typeof candidate !== 'string') continue;
    const id = candidate.trim();
    if (EXPERIENCE_ID_PATTERN.test(id)) return id;
  }
  return '';
}

function parseClosedExperiences(stored: string | null) {
  if (!stored) return new Set<string>();
  try {
    const parsed = JSON.parse(stored) as unknown;
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === 'string')
        : [],
    );
  } catch {
    return new Set<string>();
  }
}

export async function loadClosedExperiences() {
  if (closedExperiencesCache) return closedExperiencesCache;
  if (!closedExperiencesLoadPromise) {
    closedExperiencesLoadPromise = AsyncStorage.getItem(CLOSED_EXPERIENCES_STORAGE_KEY)
      .then(parseClosedExperiences)
      .catch(() => new Set<string>())
      .then((closedExperiences) => {
        closedExperiencesCache = closedExperiences;
        return closedExperiences;
      });
  }
  return closedExperiencesLoadPromise;
}

export async function isExperienceLocallyClosed(experienceId: string) {
  return (await loadClosedExperiences()).has(experienceId);
}

export async function rememberClosedExperience(experienceId: string) {
  const closedExperiences = await loadClosedExperiences();
  if (closedExperiences.has(experienceId)) return;
  closedExperiences.add(experienceId);
  await AsyncStorage.setItem(CLOSED_EXPERIENCES_STORAGE_KEY, JSON.stringify([...closedExperiences]));
}