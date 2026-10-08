const pendingUploads = new Set<Promise<unknown>>();

export function trackPendingUpload<T>(promise: Promise<T>) {
  const tracked = promise.then(
    (value) => {
      pendingUploads.delete(tracked);
      return value;
    },
    (error) => {
      pendingUploads.delete(tracked);
      throw error;
    },
  );
  pendingUploads.add(tracked);
  return tracked;
}

export async function waitForPendingUploads() {
  let failedUploads = 0;

  while (pendingUploads.size > 0) {
    const uploads = Array.from(pendingUploads);
    const results = await Promise.allSettled(uploads);
    failedUploads += results.filter((result) => result.status === 'rejected').length;
  }

  return failedUploads;
}