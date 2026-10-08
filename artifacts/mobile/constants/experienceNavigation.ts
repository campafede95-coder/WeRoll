let authorizedExperienceId = '';
let authorizationReset: ReturnType<typeof setTimeout> | null = null;

export function authorizeExperienceReturn(experienceId: string) {
  authorizedExperienceId = experienceId;
  if (authorizationReset) clearTimeout(authorizationReset);
  authorizationReset = setTimeout(() => {
    if (authorizedExperienceId === experienceId) authorizedExperienceId = '';
    authorizationReset = null;
  }, 0);
}

export function isExperienceReturnAuthorized(experienceId: string) {
  return Boolean(experienceId) && authorizedExperienceId === experienceId;
}