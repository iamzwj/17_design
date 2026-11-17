const fallback = new Map()
let unavailable = false

export function readWorkspaceStorage(key) {
  if (fallback.has(key)) return fallback.get(key)
  try { return localStorage.getItem(key) } catch { return null }
}

export function writeWorkspaceStorage(key, value) {
  try {
    localStorage.setItem(key, value)
    fallback.delete(key)
  } catch {
    fallback.set(key, String(value))
    unavailable = true
    window.dispatchEvent(new Event('dgen-storage-unavailable'))
  }
}

export function removeWorkspaceStorage(key) {
  fallback.delete(key)
  try { localStorage.removeItem(key) } catch { /* In-memory value is already removed. */ }
}

export function workspaceStorageUnavailable() { return unavailable }
