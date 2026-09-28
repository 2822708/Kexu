import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

const SPEECH_CONSENT_KEY = 'tangent_speech_consent_v1'
const consentListeners = new Set<() => void>()
let consent = false
let consentLoaded = false
let sessionOnlyConsent = false

function readStoredConsent(): boolean | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage.getItem(SPEECH_CONSENT_KEY) === 'true'
  } catch {
    return undefined
  }
}

function getConsent(): boolean {
  if (!consentLoaded) {
    consent = readStoredConsent() ?? false
    consentLoaded = true
  }
  return consent
}

function notifyConsentListeners() {
  consentListeners.forEach((listener) => listener())
}

function handleConsentStorage(event: StorageEvent) {
  if (event.key !== SPEECH_CONSENT_KEY && event.key !== null) return
  try {
    if (event.storageArea && event.storageArea !== window.localStorage) return
  } catch {
    return
  }
  consent = event.key !== null && event.newValue === 'true'
  consentLoaded = true
  sessionOnlyConsent = false
  notifyConsentListeners()
}

function subscribeToConsent(listener: () => void) {
  if (consentListeners.size === 0 && typeof window !== 'undefined') {
    // Refresh after periods with no mounted subscribers, unless storage rejected our last choice.
    if (!sessionOnlyConsent) consent = readStoredConsent() ?? getConsent()
    consentLoaded = true
    window.addEventListener('storage', handleConsentStorage)
  }
  consentListeners.add(listener)
  return () => {
    consentListeners.delete(listener)
    if (consentListeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('storage', handleConsentStorage)
    }
  }
}

function setConsent(value: boolean) {
  consent = value
  consentLoaded = true
  try {
    window.localStorage.setItem(SPEECH_CONSENT_KEY, String(value))
    sessionOnlyConsent = false
  } catch {
    // A blocked/full store must not prevent an explicit choice during this page session.
    sessionOnlyConsent = true
  }
  notifyConsentListeners()
}

/** Browser-wide disclosure consent; this never grants or requests microphone permission. */
export function useSpeechConsent(): [boolean, (value: boolean) => void] {
  return [useSyncExternalStore(subscribeToConsent, getConsent, () => false), setConsent]
}

interface SpeechInputOptions {
  onTranscript: (text: string) => void
  onError: (message: string) => void
  onStart?: () => void
}

interface SpeechRun {
  recognition: TangentSpeechRecognition
  stopping: boolean
  stopTimeout?: ReturnType<typeof setTimeout>
}

let activeSpeechOwner: { run: SpeechRun; abort: () => void } | null = null

function releaseSpeechOwner(run: SpeechRun) {
  if (activeSpeechOwner?.run === run) activeSpeechOwner = null
}

function speechConstructor() {
  return typeof window === 'undefined' ? undefined : window.SpeechRecognition ?? window.webkitSpeechRecognition
}

function detachRecognition(run: SpeechRun) {
  if (run.stopTimeout !== undefined) clearTimeout(run.stopTimeout)
  run.recognition.onresult = null
  run.recognition.onerror = null
  run.recognition.onend = null
}

/** Emits the current accumulated transcript for one explicit recording session. */
export function useSpeechInput(options: SpeechInputOptions) {
  const [recording, setRecording] = useState(false)
  const [speechConsent] = useSpeechConsent()
  const callbacksRef = useRef(options)
  const runRef = useRef<SpeechRun | null>(null)

  useEffect(() => {
    callbacksRef.current = options
  }, [options])

  const abort = useCallback(() => {
    const run = runRef.current
    if (!run) return
    runRef.current = null
    releaseSpeechOwner(run)
    detachRecognition(run)
    try {
      run.recognition.abort()
    } catch {
      // Some implementations throw if the browser already stopped the microphone.
    }
    setRecording(false)
  }, [])

  useEffect(() => abort, [abort])

  useEffect(() => {
    if (!speechConsent) abort()
  }, [speechConsent, abort])

  const start = useCallback(() => {
    if (runRef.current) return
    if (!getConsent()) {
      callbacksRef.current.onError('请先阅读并同意语音识别提示')
      return
    }
    const Speech = speechConstructor()
    if (!Speech) {
      callbacksRef.current.onError('当前浏览器不支持语音识别，请使用文字输入')
      return
    }

    let run: SpeechRun
    try {
      const recognition = new Speech()
      recognition.lang = 'zh-CN'
      recognition.continuous = true
      recognition.interimResults = true
      run = { recognition, stopping: false }
    } catch {
      callbacksRef.current.onError('无法启动语音识别，请检查浏览器或桌面应用的麦克风权限')
      return
    }

    run.recognition.onresult = (event) => {
      if (runRef.current !== run || !getConsent()) return
      const transcript = Array.from(event.results).map((result) => result[0]?.transcript ?? '').join(' ').trim()
      callbacksRef.current.onTranscript(transcript)
    }
    run.recognition.onerror = (event) => {
      if (runRef.current !== run) return
      abort()
      const errorMessages: Record<string, string> = {
        'not-allowed': '麦克风权限未获允许，请检查浏览器或桌面应用的麦克风权限',
        'service-not-allowed': '浏览器未允许语音识别服务，请检查权限或改用文字输入',
        'audio-capture': '无法访问麦克风，请检查麦克风连接与系统权限',
        network: '语音识别服务连接失败，请检查网络后重试',
        'no-speech': '未识别到语音，请重新开始录音',
        aborted: '语音识别已中断，请重新开始录音',
      }
      callbacksRef.current.onError(errorMessages[event.error ?? ''] ?? `语音识别失败${event.error ? `：${event.error}` : '，请重试'}`)
    }
    run.recognition.onend = () => {
      if (runRef.current !== run) return
      runRef.current = null
      releaseSpeechOwner(run)
      detachRecognition(run)
      setRecording(false)
    }
    // Both entry points share one microphone; switching keeps their displayed text intact.
    activeSpeechOwner?.abort()
    runRef.current = run
    activeSpeechOwner = { run, abort }
    setRecording(true)
    try {
      run.recognition.start()
    } catch {
      abort()
      callbacksRef.current.onError('无法启动麦克风，请检查浏览器或桌面应用的麦克风权限')
      return
    }
    if (runRef.current === run) callbacksRef.current.onStart?.()
  }, [abort])

  const stop = useCallback(() => {
    const run = runRef.current
    if (!run || run.stopping) return
    run.stopping = true
    // Keep the session alive for its final result; callers remain locked until onend.
    run.stopTimeout = setTimeout(() => {
      if (runRef.current === run) abort()
    }, 5000)
    try {
      run.recognition.stop()
    } catch {
      abort()
    }
  }, [abort])

  return { recording, start, stop, abort, supported: !!speechConstructor() }
}
