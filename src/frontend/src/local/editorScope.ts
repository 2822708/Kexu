import type { Schedule } from '../types'
import type { LocalState } from './types'

export interface LocalEditorScope {
  scheduleId: number
  schedulePublicId: string
}
export class LocalEditorScopeError extends Error {}
export function assertEditorGeneration(expected: number, current: number): void {
  if (expected !== current)
    throw new LocalEditorScopeError('导入窗口已关闭或目标课表已改变，过期解析结果已丢弃')
}
export function recordPublicId(record: unknown): string | null {
  if (!record || typeof record !== 'object') return null
  const value = (record as { publicId?: unknown }).publicId
  return typeof value === 'string' && value.length > 0 ? value : null
}
export function captureEditorScope(schedule: Schedule | null): LocalEditorScope {
  const publicId = recordPublicId(schedule)
  if (!schedule || !publicId) throw new LocalEditorScopeError('请先选择有效的本机课表')
  return { scheduleId: schedule.id, schedulePublicId: publicId }
}
/** Numeric IDs route a write; UUIDs prove the editor still targets the same local object. */
export function assertEditorScope(
  scope: LocalEditorScope | null,
  active: Schedule | null,
  state: LocalState,
): asserts scope is LocalEditorScope {
  if (
    !scope ||
    active?.id !== scope.scheduleId ||
    recordPublicId(active) !== scope.schedulePublicId ||
    !state.schedules.some((s) => s.id === scope.scheduleId && s.publicId === scope.schedulePublicId)
  ) {
    throw new LocalEditorScopeError('原课表已切换、删除或恢复替换，请重新打开目标课表后编辑')
  }
}
export function assertEditorRecord(
  state: LocalState,
  scope: LocalEditorScope,
  collection: 'courses' | 'exams',
  record: { id: number } | undefined,
): void {
  const publicId = recordPublicId(record)
  if (
    !record ||
    !publicId ||
    !state[collection].some(
      (row) =>
        row.id === record.id && row.publicId === publicId && row.scheduleId === scope.scheduleId,
    )
  ) {
    throw new LocalEditorScopeError('原记录已删除、恢复替换或不属于当前课表，请重新打开编辑器')
  }
}
