const pendingUploads = new Map<string, Set<Promise<unknown>>>();

export function trackPendingUpload<T>(experienceId: string, upload: Promise<T>) {
  const uploads = pendingUploads.get(experienceId) ?? new Set<Promise<unknown>>();
  uploads.add(upload);
  pendingUploads.set(experienceId, uploads);

  const removeUpload = () => {
    uploads.delete(upload);
    if (uploads.size === 0) pendingUploads.delete(experienceId);
  };
  void upload.then(removeUpload, removeUpload);

  return upload;
}

export async function waitForPendingUploads(experienceId: string) {
  while (true) {
    const uploads = pendingUploads.get(experienceId);
    if (!uploads?.size) return;
    await Promise.allSettled([...uploads]);
  }
}