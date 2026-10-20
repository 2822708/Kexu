import { legacyNames } from '../../../shared/brandCompatibility.mjs'
import { ENCRYPTED_MAX_BYTES, fromBase64, type EncryptedSnapshot } from '../local/snapshots/crypto'
import type { RecoveryCredential } from './storage'

export interface CloudSnapshotMetadata {
  snapshotId: string
  datasetId: string
  revision: number
  createdAt: string
  uploadedAt: string
  size: number
  sha256: string
}
export interface CloudSnapshotList {
  items: CloudSnapshotMetadata[]
  usedBytes: number
  limits: { snapshotBytes: number; vaultBytes: number; vaultSnapshots: number }
}
export function validateServerUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('请填写有效的云备份站点地址')
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  )
    throw new Error('云地址应只包含站点来源，例如 https://timetable.example.com')
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new Error('云备份需要 HTTPS；本机调试可使用 localhost')
  return url.origin
}
export function validateCredential(value: unknown): RecoveryCredential {
  if (!value || typeof value !== 'object') throw new Error('恢复凭证无效')
  const credential = value as RecoveryCredential
  if (
    !['kexu-cloud-recovery', legacyNames.cloudRecovery].includes(credential.format) ||
    credential.version !== 1 ||
    !/^[0-9a-f-]{36}$/i.test(credential.vaultId) ||
    !/^[A-Za-z0-9_-]{43}$/.test(credential.token) ||
    typeof credential.key !== 'string' ||
    fromBase64(credential.key).length !== 32
  )
    throw new Error('恢复凭证格式或密钥无效')
  return {
    format: 'kexu-cloud-recovery',
    version: 1,
    serverUrl: validateServerUrl(credential.serverUrl),
    vaultId: credential.vaultId,
    token: credential.token,
    key: credential.key,
  }
}
async function request<T>(
  serverUrl: string,
  path: string,
  credential?: RecoveryCredential,
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25_000)
  try {
    const response = await fetch(`${validateServerUrl(serverUrl)}${path}`, {
      ...init,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(credential
          ? { Authorization: `Bearer ${credential.vaultId}.${credential.token}` }
          : {}),
      },
    })
    if (!response.ok) {
      const messages: Record<number, string> = {
        401: '云备份凭证已失效，请重新导入正确凭证',
        403: '云备份服务不允许此站点来源',
        404: '此云快照不存在或不属于当前空间',
        409: '云快照 ID 冲突，请检查备份服务',
        413: '云快照超过服务大小限制',
        429: '云服务请求过多，将稍后自动重试',
        507: '云快照空间已满，请手动删除旧快照后重试',
      }
      throw new Error(messages[response.status] ?? '云备份服务暂时不可用')
    }
    const declared = Number(response.headers.get('content-length') ?? 0)
    if (declared > ENCRYPTED_MAX_BYTES) throw new Error('云响应超过大小限制')
    // Streaming bound also protects responses without Content-Length.
    if (!response.body) throw new Error('云服务未返回内容')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    while (true) {
      const part = await reader.read()
      if (part.done) break
      length += part.value.byteLength
      if (length > ENCRYPTED_MAX_BYTES) {
        await reader.cancel()
        throw new Error('云响应超过大小限制')
      }
      chunks.push(part.value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as T
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError')
      error.message = '云备份连接超时，将保留队列并重试'
    if (error instanceof TypeError) error.message = '无法连接云备份，离线编辑已保存在本机'
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
export async function registerVault(
  serverUrl: string,
): Promise<{ vaultId: string; token: string }> {
  return request(serverUrl, '/api/v1/vaults', undefined, { method: 'POST', body: '{}' })
}
export function uploadCloudSnapshot(
  credential: RecoveryCredential,
  body: string,
): Promise<CloudSnapshotMetadata> {
  return request(credential.serverUrl, '/api/v1/snapshots', credential, { method: 'POST', body })
}
export function listCloudSnapshots(credential: RecoveryCredential): Promise<CloudSnapshotList> {
  return request(credential.serverUrl, '/api/v1/snapshots', credential)
}
export function downloadCloudSnapshot(
  credential: RecoveryCredential,
  snapshotId: string,
): Promise<EncryptedSnapshot> {
  if (!/^[0-9a-f-]{36}$/i.test(snapshotId)) throw new Error('云快照标识无效')
  return request(credential.serverUrl, `/api/v1/snapshots/${snapshotId}/content`, credential)
}
export function deleteCloudSnapshot(
  credential: RecoveryCredential,
  snapshotId: string,
): Promise<{ deleted: boolean }> {
  if (!/^[0-9a-f-]{36}$/i.test(snapshotId)) throw new Error('云快照标识无效')
  return request(credential.serverUrl, `/api/v1/snapshots/${snapshotId}`, credential, {
    method: 'DELETE',
  })
}
