import type { AiConversation } from '../../types'
import type { LocalState } from '../types'

/** Derive one coherent local list/selection after another tab deletes or restores the database. */
export function localChatView(
  state: LocalState,
  selectedId: number | null,
  selectedPublicId: string | null,
  loadedCount = 30,
) {
  const rows = [...state.conversations].sort((a, b) => b.id - a.id)
  const selectedIndex = rows.findIndex((row) => row.id === selectedId)
  const selected = selectedIndex >= 0 ? rows[selectedIndex] : null
  const selectionMissing =
    selectedId !== null &&
    (!selected || (selectedPublicId !== null && selected.publicId !== selectedPublicId))
  const count = Math.max(30, loadedCount, selectionMissing ? 0 : selectedIndex + 1)
  const items: AiConversation[] = rows.slice(0, count)
  return {
    items,
    selectionMissing,
    nextCursor: rows.length > count ? String(items[items.length - 1].id) : null,
    selectedPublicId: selected?.publicId ?? null,
  }
}

export function currentImportConversation(
  state: LocalState,
  draft: { conversationId: number; scheduleId: number | null; conversationPublicId?: string },
): boolean {
  return state.conversations.some(
    (row) =>
      row.id === draft.conversationId &&
      row.scheduleId === draft.scheduleId &&
      (!draft.conversationPublicId || row.publicId === draft.conversationPublicId),
  )
}
