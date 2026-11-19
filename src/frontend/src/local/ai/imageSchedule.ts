import type { Schedule } from '../../types'
import { mutateLocalState } from '../db'
import { createSchedule } from '../domain'
import type { LocalSchedule } from '../types'
import { assertLocal } from '../validation'

export interface ImageScheduleScope {
  dataset: string
  conversationId: number | null
  conversationPublicId: string | null
}

/** The first schedule and its chat binding must succeed or fail together. */
export function createImageSchedule(
  body: Omit<Schedule, 'id'>,
  scope: ImageScheduleScope,
): Promise<LocalSchedule> {
  return mutateLocalState((state) => {
    assertLocal(
      `${state.datasetId}:${state.dataGeneration}` === scope.dataset,
      '本机数据已更换，请确认当前课表后再发送图片',
    )
    assertLocal(state.schedules.length === 0, '已经有可用课表，请选择目标课表后再发送图片')

    const conversation = state.conversations.find(
      (row) => row.id === scope.conversationId && row.publicId === scope.conversationPublicId,
    )
    assertLocal(
      scope.conversationId === null
        ? scope.conversationPublicId === null
        : conversation?.scheduleId === null,
      '当前对话已更换或绑定其他课表，请重新确认后再发送图片',
    )

    const schedule = createSchedule(state, body)
    if (conversation) {
      conversation.scheduleId = schedule.id
      conversation.updatedAt = new Date().toISOString()
    }
    return schedule
  })
}
