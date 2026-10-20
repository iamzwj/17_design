import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
export const MODEL_REVISION = '2c4055b12046f11709e9df2c122e59ffbdc2f900'
export async function ensureModel(cacheDir) {
  const directory = path.join(cacheDir, 'multilingual-minilm', MODEL_REVISION)
  for (const file of ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'onnx/model_quantized.onnx']) {
    const target = path.join(directory, file)
    if (await fs.stat(target).then((s) => s.size > 0).catch(() => false)) continue
    await fs.mkdir(path.dirname(target), { recursive: true })
    try {
      await run('curl', ['--fail', '--location', '--silent', '--show-error', '--retry', '3', '--connect-timeout', '15', '--max-time', '240', '--output', `${target}.part`, `https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/${MODEL_REVISION}/${file}`], { timeout: 260000 })
      if (file.endsWith('.json')) JSON.parse(await fs.readFile(`${target}.part`, 'utf8'))
      else if ((await fs.stat(`${target}.part`)).size < 10_000_000) throw new Error('模型文件不完整')
      await fs.rename(`${target}.part`, target)
    } catch (error) { await fs.rm(`${target}.part`, { force: true }); throw new Error(`模型文件 ${file} 下载失败，请重试：${error.message.slice(0, 160)}`) }
  }
  return directory
}
