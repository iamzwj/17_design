import { Worker } from 'node:worker_threads'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const EMBEDDING_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
export function createEmbedder(cacheDir) {
  let worker, serial = Promise.resolve(), seq = 0
  const pending = new Map()
  function start() {
    const instance = new Worker(fileURLToPath(new URL('./vectorWorker.js', import.meta.url)), { execArgv: [], workerData: { cacheDir: path.resolve(cacheDir), model: EMBEDDING_MODEL } })
    worker = instance
    instance.on('message', ({ id, vectors, error }) => {
      const job = pending.get(id); if (!job) return
      pending.delete(id); clearTimeout(job.timer)
      if (error) job.reject(new Error(error)); else job.resolve(vectors)
    })
    const fail = (error) => { for (const job of pending.values()) { clearTimeout(job.timer); job.reject(error) }; pending.clear(); if (worker === instance) worker = null }
    instance.on('error', fail)
    instance.on('exit', (code) => { if (code) fail(new Error('本地向量模型进程退出，请重试')) })
  }
  function embed(texts) {
    const operation = serial.catch(() => {}).then(() => new Promise((resolve, reject) => {
      if (!worker) start()
      const id = ++seq
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('本地向量模型准备或处理超时，请检查模型文件后重试')); worker?.terminate(); worker = null }, 300_000)
      pending.set(id, { resolve, reject, timer }); worker.postMessage({ id, texts })
    }))
    serial = operation
    return operation
  }
  return { embed, close: () => worker?.terminate() }
}
