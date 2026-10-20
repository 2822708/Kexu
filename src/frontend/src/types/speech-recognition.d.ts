interface KexuSpeechResult {
  readonly [index: number]: { readonly transcript: string }
  readonly length: number
  readonly isFinal: boolean
}

interface KexuSpeechEvent extends Event {
  readonly resultIndex: number
  readonly results: ArrayLike<KexuSpeechResult>
}

interface KexuSpeechRecognition extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: KexuSpeechEvent) => void) | null
  onerror: ((event: Event & { error?: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

interface Window {
  SpeechRecognition?: new () => KexuSpeechRecognition
  webkitSpeechRecognition?: new () => KexuSpeechRecognition
}
