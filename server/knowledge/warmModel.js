import path from 'node:path'
import { createEmbedder } from './embedding.js'
const cacheDir = process.env.KNOWLEDGE_MODEL_CACHE || path.join(process.env.DIEFA_DATA_DIR || 'data', 'knowledge', 'models')
const embedder = createEmbedder(cacheDir)
try {
  const vectors = await embedder.embed(['品牌标志用色规范', 'Logo颜色使用规则', '今天晚饭吃什么'])
  const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0)
  if (vectors[0]?.length !== 384 || dot(vectors[0], vectors[1]) < dot(vectors[0], vectors[2]) + 0.2) throw new Error('中文语义模型自检失败')
  console.log(`Knowledge model ready: 384 dimensions; related=${dot(vectors[0], vectors[1]).toFixed(3)}; unrelated=${dot(vectors[0], vectors[2]).toFixed(3)}`)
} finally { await embedder.close() }
