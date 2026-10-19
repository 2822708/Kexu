import { readLocalState, replaceLocalState, validateLocalState } from '../db'
import { saveRestorePoint } from '../../backup/storage'
import {
  createLogicalSnapshot,
  materializeSnapshot,
  snapshotCounts,
  validateLogicalSnapshot,
  type LogicalSnapshot,
} from './codec'

export interface RestorePreview {
  snapshot: LogicalSnapshot
  expectedRevision: number
  receiverDatasetId: string
  counts: ReturnType<typeof snapshotCounts>
}

/** Local-only checkpoint for safe application updates; it never contacts the cloud. */
export async function saveCurrentRestorePoint(expectedRevision?: number): Promise<{
  snapshotId: string
  revision: number
  datasetId: string
}> {
  const current = await readLocalState()
  if (expectedRevision != null && current.revision !== expectedRevision)
    throw new Error('本地数据已改变，请保存当前编辑后重试更新')
  const snapshot = createLogicalSnapshot(current)
  await saveRestorePoint(snapshot)
  const latest = await readLocalState()
  if (latest.datasetId !== current.datasetId || latest.revision !== current.revision)
    throw new Error('保存恢复点期间有新编辑，请重新确认更新')
  return {
    snapshotId: snapshot.snapshotId,
    revision: current.revision,
    datasetId: current.datasetId,
  }
}
export async function previewRestore(input: unknown): Promise<RestorePreview> {
  const snapshot = validateLogicalSnapshot(input)
  const current = await readLocalState()
  validateLocalState(materializeSnapshot(snapshot, current))
  return {
    snapshot,
    expectedRevision: current.revision,
    receiverDatasetId: current.datasetId,
    counts: snapshotCounts(snapshot),
  }
}
/** User must approve the preview before calling; stale approvals are never reused. */
export async function restoreConfirmed(preview: RestorePreview): Promise<void> {
  const current = await readLocalState()
  if (
    current.datasetId !== preview.receiverDatasetId ||
    current.revision !== preview.expectedRevision
  )
    throw new Error('预览后本地数据已改变，请重新预览并确认恢复')
  const next = materializeSnapshot(preview.snapshot, current)
  validateLocalState(next)
  await saveRestorePoint(createLogicalSnapshot(current))
  // replaceLocalState performs another revision check inside its single readwrite transaction.
  await replaceLocalState(next, preview.expectedRevision)
}
