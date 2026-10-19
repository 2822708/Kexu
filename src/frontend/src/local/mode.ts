/** PWA and the bundled WebView apps share the local store; the legacy desktop keeps its Java adapter. */
export const NATIVE_SHELL = import.meta.env.MODE === 'shell'
export const LOCAL_MODE =
  NATIVE_SHELL || import.meta.env.MODE === 'mobile' || import.meta.env.VITE_LOCAL_DATA === 'true'
