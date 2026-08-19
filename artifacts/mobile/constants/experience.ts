export const LAST_EXPERIENCE_ID_STORAGE_KEY = 'pic-sync-last-experience-id';

const EXPERIENCE_ID_PATTERN = /^\d+-[a-z0-9]+$/i;

export function resolveExperienceId(...values: Array<string | string[] | undefined | null>) {
  for (const value of values) {
    const candidate = Array.isArray(value) ? value[0] : value;
    if (typeof candidate !== 'string') continue;
    const id = candidate.trim();
    if (EXPERIENCE_ID_PATTERN.test(id)) return id;
  }
  return '';
}