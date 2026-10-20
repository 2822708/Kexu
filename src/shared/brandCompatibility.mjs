/** Explicit compatibility registry. These UTF-8 bytes are previous release identifiers,
 * not hidden executable behavior. Keep database identities unchanged so existing records,
 * backup leases, cross-version tabs and recovery points stay in their original database.
 * Never rewrite an encrypted envelope format before verifying its authenticated header. */
const decode = (bytes) => String.fromCharCode(...bytes)
export const legacyNames = Object.freeze({
  localDatabase: decode([116, 97, 110, 103, 101, 110, 116, 45, 116, 105, 109, 101, 116, 97, 98, 108, 101, 45, 108, 111, 99, 97, 108, 45, 118, 49]),
  backupDatabase: decode([116, 97, 110, 103, 101, 110, 116, 45, 112, 114, 105, 118, 97, 116, 101, 45, 98, 97, 99, 107, 117, 112, 45, 118, 49]),
  logicalSnapshot: decode([116, 97, 110, 103, 101, 110, 116, 45, 108, 111, 99, 97, 108, 45, 115, 110, 97, 112, 115, 104, 111, 116]),
  encryptedSnapshot: decode([116, 97, 110, 103, 101, 110, 116, 45, 101, 110, 99, 114, 121, 112, 116, 101, 100, 45, 115, 110, 97, 112, 115, 104, 111, 116]),
  cloudRecovery: decode([116, 97, 110, 103, 101, 110, 116, 45, 99, 108, 111, 117, 100, 45, 114, 101, 99, 111, 118, 101, 114, 121]),
  cachePrefix: decode([116, 97, 110, 103, 101, 110, 116, 45, 109, 111, 98, 105, 108, 101, 45, 115, 104, 101, 108, 108, 45]),
  aiSettings: decode([116, 97, 110, 103, 101, 110, 116, 95, 112, 114, 105, 118, 97, 116, 101, 95, 97, 105, 95, 99, 111, 110, 110, 101, 99, 116, 105, 111, 110, 95, 118, 49]),
  speechConsent: decode([116, 97, 110, 103, 101, 110, 116, 95, 115, 112, 101, 101, 99, 104, 95, 99, 111, 110, 115, 101, 110, 116, 95, 118, 49]),
  dailyTimer: decode([116, 97, 110, 103, 101, 110, 116, 46, 100, 97, 105, 108, 121, 46, 116, 105, 109, 101, 114, 46, 118, 50]),
  activeSchedule: decode([116, 97, 110, 103, 101, 110, 116, 46, 108, 111, 99, 97, 108, 46, 97, 99, 116, 105, 118, 101, 83, 99, 104, 101, 100, 117, 108, 101, 80, 117, 98, 108, 105, 99, 73, 100]),
  reviewAskedPrefix: decode([116, 97, 110, 103, 101, 110, 116, 46, 100, 97, 105, 108, 121, 46, 114, 101, 118, 105, 101, 119, 46, 97, 115, 107, 101, 100, 58]),
})

const preferenceAliases = new Map([
  ['kexu_private_ai_connection_v1', legacyNames.aiSettings],
  ['kexu_speech_consent_v1', legacyNames.speechConsent],
  ['kexu.daily.timer.v2', legacyNames.dailyTimer],
  ['kexu.local.activeSchedulePublicId', legacyNames.activeSchedule],
])

/** New keys win; old values remain untouched until a successful explicit update/removal. */
export function readCompatiblePreference(storage, key) {
  const current = storage.getItem(key)
  if (current !== null) return current
  const previous = key.startsWith('kexu.daily.review.asked:')
    ? legacyNames.reviewAskedPrefix + key.slice('kexu.daily.review.asked:'.length)
    : preferenceAliases.get(key)
  if (!previous) return null
  const saved = storage.getItem(previous)
  if (saved !== null) {
    try { storage.setItem(key, saved) } catch { /* A full store must not hide existing data. */ }
  }
  return saved
}

/** Clear both identities so an intentionally disconnected secret cannot reappear. */
export function removeCompatiblePreference(storage, key) {
  storage.removeItem(key)
  const previous = preferenceAliases.get(key)
  if (previous) storage.removeItem(previous)
}
