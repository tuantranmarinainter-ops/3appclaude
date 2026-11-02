const STORAGE_KEY = 'topview.3d-builder.navigation-hint-dismissed.v1'
// B8: localStorage is per port (3016, 3025, test servers…); cookies are shared by every port of the same host.
const COOKIE = 't3d-nav-hint-dismissed=1'
let dismissed = false

function cookieDismissed(): boolean {
  try { return document.cookie.split(';').some((part) => part.trim() === COOKIE) } catch { return false }
}

export const navigationHintPreference = {
  read(): boolean {
    if (dismissed || cookieDismissed()) return true
    try {
      return window.localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      return false
    }
  },
  dismiss(): void {
    dismissed = true
    try {
      document.cookie = `${COOKIE}; path=/; max-age=31536000; SameSite=Lax`
    } catch {
      // Cookies off: localStorage below still remembers it for this port.
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      // Retain the preference in memory if browser storage is unavailable.
    }
  },
}
