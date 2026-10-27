import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const run = promisify(execFile)
export async function renderPptx(file) {
  const cached = `${file}.vision.pdf`
  try { await fs.access(cached); return cached } catch { /* Convert once per immutable original. */ }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dgen-pptx-'))
  try {
    await run(process.env.KNOWLEDGE_SOFFICE || 'soffice', [`-env:UserInstallation=file://${directory}/profile`, '--headless', '--convert-to', 'pdf', '--outdir', directory, file], { timeout: 180000, maxBuffer: 1024 * 1024 })
    const pdf = path.join(directory, `${path.basename(file, path.extname(file))}.pdf`)
    const bytes = await fs.readFile(pdf)
    if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('转换结果不是PDF')
    await fs.writeFile(cached, bytes, { mode: 0o600 })
    return cached
  } catch (error) { throw new Error(`PPTX 页面转换失败，请重试或上传PDF：${error.code === 'ENOENT' ? '服务器未安装页面转换组件' : '转换未完成'}`) }
  finally { await fs.rm(directory, { recursive: true, force: true }) }
}
