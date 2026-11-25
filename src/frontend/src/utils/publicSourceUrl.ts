/** Source links are opened explicitly by the reader. Never activate another URL scheme. */
export function publicSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000 || /\s/.test(value)) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 2000
      ? url.href
      : null
  } catch {
    return null
  }
}
