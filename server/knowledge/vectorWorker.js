import { parentPort, workerData } from 'node:worker_threads'
import { ensureModel } from './modelFiles.js'
import { pipeline, env } from '@huggingface/transformers'
env.cacheDir = workerData.cacheDir
env.backends.onnx.wasm.numThreads = 1
let extractor
parentPort.on('message', async ({ id, texts }) => {
  try {
    if (!extractor) {
      const modelPath = await ensureModel(workerData.cacheDir)
      env.allowRemoteModels = false
      extractor = await pipeline('feature-extraction', modelPath, { dtype: 'q8', device: 'cpu', session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 } })
    }
    const vectors = []
    for (let i = 0; i < texts.length; i += 4) {
      const result = await extractor(texts.slice(i, i + 4), { pooling: 'mean', normalize: true, truncation: true, max_length: 512 })
      vectors.push(...result.tolist())
    }
    parentPort.postMessage({ id, vectors })
  } catch (error) { extractor = null; parentPort.postMessage({ id, error: `本地向量化失败：${error.message}` }) }
})
