import { useEffect } from 'react'

/** Keep the chat composer above software keyboards that do not resize layout viewport. */
export function useVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const update = () => {
      document.documentElement.style.setProperty('--app-height', `${viewport.height}px`)
      const editing = document.activeElement?.matches('input, textarea, [contenteditable="true"]')
      document.documentElement.toggleAttribute(
        'data-keyboard-open',
        Boolean(editing && window.innerHeight - viewport.height > 120),
      )
    }
    update()
    viewport.addEventListener('resize', update)
    window.addEventListener('focusin', update)
    window.addEventListener('focusout', update)
    return () => {
      viewport.removeEventListener('resize', update)
      window.removeEventListener('focusin', update)
      window.removeEventListener('focusout', update)
      document.documentElement.style.removeProperty('--app-height')
      document.documentElement.removeAttribute('data-keyboard-open')
    }
  }, [])
}
