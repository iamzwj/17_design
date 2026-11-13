import path from 'node:path'
import sharp from 'sharp'

export async function prepareFilmFrameReferences(projectDir, references) {
  return Promise.all(references.map(async ({ file }) => {
    if (!file || path.basename(file) !== file) throw new Error('首帧参考图文件名无效')
    const jpeg = await sharp(path.join(projectDir, file), { limitInputPixels: 50_000_000 })
      .rotate()
      .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 86 })
      .toBuffer()
    return 'data:image/jpeg;base64,' + jpeg.toString('base64')
  }))
}
