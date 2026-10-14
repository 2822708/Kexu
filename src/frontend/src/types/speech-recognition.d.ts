interface TangentSpeechResult {
  readonly [index: number]: { readonly transcript: string }
  readonly length: number
  readonly isFinal: boolean
}

interface TangentSpeechEvent extends Event {
  readonly resultIndex: number
  readonly results: ArrayLike<TangentSpeechResult>
}

interface TangentSpeechRecognition extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: TangentSpeechEvent) => void) | null
  onerror: ((event: Event & { error?: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

interface Window {
  SpeechRecognition?: new () => TangentSpeechRecognition
  webkitSpeechRecognition?: new () => TangentSpeechRecognition
}
