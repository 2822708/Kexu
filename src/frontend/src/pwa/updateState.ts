/** The installed event may precede registration.waiting becoming observable. */
export function findWaitingUpdate(
  registration: Pick<ServiceWorkerRegistration, 'waiting' | 'active'> | undefined,
  installing: ServiceWorker | null,
  controlled: boolean,
): ServiceWorker | null {
  if (registration?.waiting) return registration.waiting
  if (installing?.state === 'installed' && (registration?.active || controlled)) return installing
  return null
}
