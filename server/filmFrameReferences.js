import path from 'node:path'
import sharp from 'sharp'

export async function filmImageJpeg(source) {
  const image = sharp(source, { limitInputPixels: 50_000_000 }).rotate()
    .flatten({ background: '#ffffff' })
  for (const [size, quality] of [[1280, 84], [1280, 70], [960, 65], [640, 60]]) {
    const jpeg = await image.clone()
      .resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality }).toBuffer()
    if (jpeg.length <= 400_000) return jpeg
  }
  throw new Error('参考图压缩后仍超过审核传输预算')
}

export async function prepareFilmFrameReferences(projectDir, references) {
  return Promise.all(references.map(async ({ file }) => {
    if (!file || path.basename(file) !== file) throw new Error('首帧参考图文件名无效')
    const jpeg = await filmImageJpeg(path.join(projectDir, file))
    return 'data:image/jpeg;base64,' + jpeg.toString('base64')
  }))
}
