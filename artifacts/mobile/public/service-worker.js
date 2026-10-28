const CACHE_NAME = 'weroll-shell-v1';
const CLOSED_EXPERIENCES_CACHE = 'weroll-closed-experiences-v1';
const diagnosticPushCounts = new Map();
const diagnosticShowNotificationCounts = new Map();

function logPushDiagnostic(eventName, details = {}) {
  console.log(`[WeRoll SW Push] ${eventName}`, new Date().toISOString(), details);
}

function logPushDiagnosticError(eventName, details = {}) {
  console.error(`[WeRoll SW Push] ${eventName}`, new Date().toISOString(), details);
}

function incrementDiagnosticCount(counts, key) {
  const nextCount = (counts.get(key) || 0) + 1;
  counts.set(key, nextCount);
  return nextCount;
}

function closedExperienceRequest(experienceId) {
  return new Request(`/__weroll-closed/${encodeURIComponent(experienceId)}`);
}

async function rememberClosedExperience(experienceId) {
  const cache = await caches.open(CLOSED_EXPERIENCES_CACHE);
  await cache.put(closedExperienceRequest(experienceId), new Response('closed'));
}

async function isExperienceClosed(experienceId) {
  const cache = await caches.open(CLOSED_EXPERIENCES_CACHE);
  return Boolean(await cache.match(closedExperienceRequest(experienceId)));
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'experience-closed' || typeof event.data.experienceId !== 'string') return;
  event.waitUntil((async () => {
    await rememberClosedExperience(event.data.experienceId);
    const notifications = typeof self.registration.getNotifications === 'function'
      ? await self.registration.getNotifications()
      : [];
    notifications
      .filter((notification) => notification.data?.experienceId === event.data.experienceId)
      .forEach((notification) => notification.close());
  })());
});

function isRemoteImageRequest(request) {
  const requestUrl = new URL(request.url);
  if (requestUrl.origin === self.location.origin) return false;
  return request.destination === 'image' || requestUrl.hostname === 'storage.googleapis.com';
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (isRemoteImageRequest(event.request)) return;

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request)),
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  let payloadParseFailed = false;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    payloadParseFailed = true;
    data = { title: 'Nuovo ricordo', body: 'È arrivato un nuovo momento da catturare.' };
  }

  const experienceId = typeof data.experienceId === 'string' ? data.experienceId : '';
  const reminderId = typeof data.reminderId === 'string' ? data.reminderId : '';
  const scheduledAt = typeof data.scheduledAt === 'string' ? data.scheduledAt : '';
  const messageVariant = typeof data.messageVariant === 'string' ? data.messageVariant : '';
  const diagnosticReminderKey = reminderId || '<missing>';
  const receivedCount = incrementDiagnosticCount(diagnosticPushCounts, diagnosticReminderKey);
  const notificationTag = data.tag || (experienceId && reminderId ? `${experienceId}:${reminderId}` : 'weroll-reminder');
  const notificationTagSource = data.tag ? 'payload' : 'fallback';
  logPushDiagnostic('received', {
    dataPresent: Boolean(event.data),
    payloadParseFailed,
    receivedCountForReminderId: receivedCount,
    reminderId: reminderId || '<missing>',
    experienceId: experienceId || '<missing>',
    scheduledAt: scheduledAt || '<missing>',
  });
  logPushDiagnostic('reminderId', {
    reminderId: reminderId || '<missing>',
    experienceId: experienceId || '<missing>',
  });
  logPushDiagnostic('notification tag', {
    reminderId: reminderId || '<missing>',
    experienceId: experienceId || '<missing>',
    tag: notificationTag,
    tagSource: notificationTagSource,
    sameReminderFallbackTag: Boolean(experienceId && reminderId),
    renotify: 'omitted',
    requireInteraction: 'omitted',
  });
  const params = new URLSearchParams({
    experienceId,
    reminderId,
    scheduledAt,
    ...(messageVariant ? { messageVariant } : {}),
  });
  event.waitUntil((async () => {
    try {
      if (experienceId && await isExperienceClosed(experienceId)) {
        logPushDiagnostic('showNotification skipped', {
          reason: 'experience closed',
          reminderId: reminderId || '<missing>',
          experienceId,
          tag: notificationTag,
        });
        return;
      }
      const showNotificationCount = incrementDiagnosticCount(
        diagnosticShowNotificationCounts,
        diagnosticReminderKey,
      );
      const showNotificationStartedAt = Date.now();
      logPushDiagnostic('before showNotification', {
        reminderId: reminderId || '<missing>',
        experienceId: experienceId || '<missing>',
        showNotificationCountForReminderId: showNotificationCount,
        tag: notificationTag,
        renotify: 'omitted',
        requireInteraction: 'omitted',
      });
      await self.registration.showNotification(data.title || 'Nuovo ricordo', {
        body: data.body || 'È arrivato un nuovo momento da catturare.',
        icon: data.icon || '/icon.png',
        badge: data.badge || '/icon.png',
        tag: notificationTag,
        silent: false,
        renotify: true,
        data: {
          url: experienceId ? `/moment/${encodeURIComponent(experienceId)}?${params.toString()}` : '/',
          experienceId,
          reminderId,
          scheduledAt,
        },
      });
      logPushDiagnostic('showNotification completed', {
        reminderId: reminderId || '<missing>',
        experienceId: experienceId || '<missing>',
        showNotificationCountForReminderId: showNotificationCount,
        tag: notificationTag,
        durationMs: Date.now() - showNotificationStartedAt,
      });
    } catch (error) {
      logPushDiagnosticError('showNotification failed', {
        reminderId: reminderId || '<missing>',
        experienceId: experienceId || '<missing>',
        tag: notificationTag,
        errorName: error instanceof Error ? error.name : 'unknown error',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  console.log('[WeRoll SW] notificationclick received');
  event.notification.close();
  const targetUrl = event.notification.data && typeof event.notification.data.url === 'string'
    ? new URL(event.notification.data.url, self.registration.scope).href
    : self.registration.scope;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => 'focus' in client);
      if (existing) {
        existing.navigate(targetUrl);
        return existing.focus();
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
