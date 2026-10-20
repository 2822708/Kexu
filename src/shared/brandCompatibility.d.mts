export type LegacyIdentifier = string & { readonly __legacyIdentifier: unique symbol }
export const legacyNames: Readonly<{
  localDatabase: LegacyIdentifier
  backupDatabase: LegacyIdentifier
  logicalSnapshot: LegacyIdentifier
  encryptedSnapshot: LegacyIdentifier
  cloudRecovery: LegacyIdentifier
  cachePrefix: LegacyIdentifier
  aiSettings: LegacyIdentifier
  speechConsent: LegacyIdentifier
  dailyTimer: LegacyIdentifier
  activeSchedule: LegacyIdentifier
  reviewAskedPrefix: LegacyIdentifier
}>
export function readCompatiblePreference(storage: Pick<Storage, "getItem" | "setItem">, key: string): string | null
export function removeCompatiblePreference(storage: Pick<Storage, "removeItem">, key: string): void
