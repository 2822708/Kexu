// Android WebView and the PWA allow same-origin scripts under their CSP.
(() => {
  try {
    const mode = localStorage.getItem('timetable-theme')
    if (mode === 'dark' || mode === 'light') document.documentElement.dataset.theme = mode
  } catch {
    // Preferences are optional when browser storage is restricted.
  }

  function showError() {
    const status = document.getElementById('boot-start-status')
    const error = document.getElementById('boot-start-error')
    if (!status || !error || !error.hidden) return
    status.hidden = true
    error.hidden = false
    document.getElementById('boot-start-retry').addEventListener('click', () => location.reload())
  }

  function onScriptError(event) {
    if (event.target instanceof HTMLScriptElement && event.target.type === 'module') {
      showError()
    }
  }

  const timer = window.setTimeout(showError, 15_000)
  window.addEventListener('error', onScriptError, true)
  window.addEventListener('kexu:react-mounted', () => {
    window.clearTimeout(timer)
    window.removeEventListener('error', onScriptError, true)
  }, { once: true })
})()
