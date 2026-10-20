import { legacyNames } from '../../../../shared/brandCompatibility.mjs'
import { SNAPSHOT_MAX_BYTES, validateLogicalSnapshot, type LogicalSnapshot } from './codec'

export interface EncryptedSnapshot {
  format: 'kexu-encrypted-snapshot' | typeof legacyNames.encryptedSnapshot
  version: 1
  snapshotId: string
  datasetId: string
  revision: number
  createdAt: string
  algorithm: 'AES-GCM-256'
  keyId: string
  iv: string
  ciphertext: string
}
export const ENCRYPTED_MAX_BYTES = 10 * 1024 * 1024
export function toBase64(bytes: Uint8Array): string {
  let raw = ''
  for (let start = 0; start < bytes.length; start += 8192)
    raw += String.fromCharCode(...bytes.subarray(start, start + 8192))
  return btoa(raw)
}
export function fromBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('密钥或快照编码无效')
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}
export function generateBackupKey(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(32)))
}
export async function sha256(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  const buffer = bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).buffer
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}
async function importKey(value: string) {
  const bytes = fromBase64(value)
  if (bytes.length !== 32) throw new Error('恢复密钥长度无效')
  const keyId = (await sha256(bytes)).slice(0, 32)
  return {
    keyId,
    key: await crypto.subtle.importKey('raw', new Uint8Array(bytes).buffer, 'AES-GCM', false, [
      'encrypt',
      'decrypt',
    ]),
  }
}
function authenticatedHeader(envelope: Omit<EncryptedSnapshot, 'iv' | 'ciphertext'>) {
  return new TextEncoder().encode(
    JSON.stringify({
      format: envelope.format,
      version: envelope.version,
      snapshotId: envelope.snapshotId,
      datasetId: envelope.datasetId,
      revision: envelope.revision,
      createdAt: envelope.createdAt,
      algorithm: envelope.algorithm,
      keyId: envelope.keyId,
    }),
  )
}
export async function encryptSnapshot(
  snapshot: LogicalSnapshot,
  rawKey: string,
): Promise<EncryptedSnapshot> {
  validateLogicalSnapshot(snapshot)
  const { key, keyId } = await importKey(rawKey)
  const header: Omit<EncryptedSnapshot, 'iv' | 'ciphertext'> = {
    format: 'kexu-encrypted-snapshot',
    version: 1,
    snapshotId: snapshot.snapshotId,
    datasetId: snapshot.source.datasetId,
    revision: snapshot.source.revision,
    createdAt: snapshot.createdAt,
    algorithm: 'AES-GCM-256',
    keyId,
  }
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: authenticatedHeader(header), tagLength: 128 },
    key,
    new TextEncoder().encode(JSON.stringify(snapshot)),
  )
  return { ...header, iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) }
}
export async function decryptSnapshot(input: unknown, rawKey: string): Promise<LogicalSnapshot> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('加密快照无效')
  const envelope = input as EncryptedSnapshot
  if (
    !['kexu-encrypted-snapshot', legacyNames.encryptedSnapshot].includes(envelope.format) ||
    envelope.version !== 1 ||
    envelope.algorithm !== 'AES-GCM-256' ||
    typeof envelope.iv !== 'string' ||
    typeof envelope.ciphertext !== 'string'
  )
    throw new Error('加密格式不受支持')
  if (new TextEncoder().encode(JSON.stringify(envelope)).length > ENCRYPTED_MAX_BYTES)
    throw new Error('云快照超过大小限制')
  const { key, keyId } = await importKey(rawKey)
  if (keyId !== envelope.keyId) throw new Error('此恢复凭证不能解密该快照')
  const iv = fromBase64(envelope.iv)
  if (iv.length !== 12) throw new Error('加密快照 IV 无效')
  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array(iv).buffer,
        additionalData: authenticatedHeader(envelope),
        tagLength: 128,
      },
      key,
      new Uint8Array(fromBase64(envelope.ciphertext)).buffer,
    )
  } catch {
    throw new Error('解密失败：快照被修改或恢复密钥不正确')
  }
  if (plaintext.byteLength > SNAPSHOT_MAX_BYTES) throw new Error('解密内容超过大小限制')
  const snapshot = validateLogicalSnapshot(JSON.parse(new TextDecoder().decode(plaintext)))
  if (
    snapshot.snapshotId !== envelope.snapshotId ||
    snapshot.source.datasetId !== envelope.datasetId ||
    snapshot.source.revision !== envelope.revision ||
    snapshot.createdAt !== envelope.createdAt
  )
    throw new Error('快照元数据与加密内容不一致')
  return snapshot
}
