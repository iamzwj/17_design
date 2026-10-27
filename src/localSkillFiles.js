export async function markdownHash(text) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((n) => n.toString(16).padStart(2, '0')).join('') }
function validate(id) { if (!/^external-[a-f0-9-]{36}$/.test(id)) throw new Error('本地 Skill 标识无效') }
async function directory(owner, create) {
  const root = await navigator.storage.getDirectory()
  return (await root.getDirectoryHandle('dgen-external-skills', { create })).getDirectoryHandle(await markdownHash(owner), { create })
}
async function idb(method, key, value) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('dgen-local-skill-files', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('files')
    request.onerror = () => reject(new Error('无法打开本地文件区，请检查浏览器存储权限'))
    request.onsuccess = () => {
      const db = request.result, transaction = db.transaction('files', method === 'get' ? 'readonly' : 'readwrite')
      const store = transaction.objectStore('files'), op = method === 'put' ? store.put(value, key) : method === 'delete' ? store.delete(key) : store.get(key)
      let result; op.onsuccess = () => { result = op.result }; transaction.oncomplete = () => { db.close(); resolve(result) }; transaction.onerror = () => { db.close(); reject(transaction.error) }; transaction.onabort = () => { db.close(); reject(transaction.error || new Error('本地文件写入中断')) }
    }
  })
}
export async function writeLocalSkill(owner, record, markdown) {
  validate(record.id)
  if (await markdownHash(markdown) !== record.sha256) throw new Error('Skill 文件校验失败，请重新下载')
  if (navigator.storage?.getDirectory) {
    const parent = await directory(owner, true), folder = await parent.getDirectoryHandle(record.id, { create: true }), handle = await folder.getFileHandle('SKILL.md', { create: true })
    const writer = await handle.createWritable(); try { await writer.write(new Blob([markdown], { type: 'text/markdown;charset=utf-8' })); await writer.close() } catch (e) { await writer.abort().catch(() => {}); throw e }
  } else await idb('put', `${await markdownHash(owner)}/${record.id}`, new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
  await readLocalSkill(owner, record)
}
export async function readLocalSkill(owner, record) {
  validate(record.id); let blob
  try {
    if (navigator.storage?.getDirectory) { const parent = await directory(owner, false); const folder = await parent.getDirectoryHandle(record.id); blob = await (await folder.getFileHandle('SKILL.md')).getFile() }
    else blob = await idb('get', `${await markdownHash(owner)}/${record.id}`)
  } catch (e) { if (e.name !== 'NotFoundError') throw e }
  if (!blob) throw new Error('本机缺少 Skill MD 文件，请到“发现 Skill → 已安装”重新下载')
  const markdown = await blob.text()
  if (await markdownHash(markdown) !== record.sha256) throw new Error('本地 MD 文件已变更或损坏，请重新下载')
  return markdown
}
export async function removeLocalSkill(owner, record) {
  validate(record.id)
  if (navigator.storage?.getDirectory) { try { await (await directory(owner, false)).removeEntry(record.id, { recursive: true }) } catch (e) { if (e.name !== 'NotFoundError') throw e } }
  else await idb('delete', `${await markdownHash(owner)}/${record.id}`)
}
