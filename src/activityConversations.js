let database

function openDatabase() {
  if (!database) {
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open('dgen-activity-conversations', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('accounts')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }
  return database
}

async function activityHistory(mode, operation) {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('accounts', mode)
    const request = operation(transaction.objectStore('accounts'))
    transaction.oncomplete = () => resolve(request.result)
    transaction.onabort = () => reject(transaction.error)
  })
}

export function readActivityHistory(key) {
  return activityHistory('readonly', store => store.get(key))
}

export function saveActivityHistory(key, records) {
  return activityHistory('readwrite', store => store.put(records.filter(record => record.type === 'strategy'), key))
}
