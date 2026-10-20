export const IP_ASSETS = [
  { brand: '万物云', id: 'onewo-yixiu', group: 'cartoon', kind: '主形象全身照', name: '一修 · 打招呼', file: '/material-library/onewo-yixiu.png', note: '万物云 3D IP' },
  { brand: '万物云', id: 'onewo-xiaozhizhi', group: 'cartoon', kind: '主形象全身照', name: '管家小知之', file: '/material-library/onewo-xiaozhizhi.png', note: '万物云 3D IP' },
  { brand: '万物云', id: 'onewo-keke', group: 'cartoon', kind: '主形象全身照', name: '可可 · 解说', file: '/material-library/onewo-keke.png', note: '万物云 3D IP' },
  { brand: '万物云', id: 'onewo-ange', group: 'cartoon', kind: '主形象全身照', name: '安哥 · 敬礼', file: '/material-library/onewo-ange.png', note: '万物云 3D IP' },
  { id: 'xiaojie', group: 'cartoon', kind: '主形象全身照', name: '小杰', file: '/material-library/xiaojie.png', note: '品线 3D IP' },
  { brand: '研选家', id: 'yanxuanjia-painter', group: 'cartoon', kind: '主形象全身照', name: '研选家 · 刷墙师傅', file: '/material-library/yanxuanjia-painter.png', note: '研选家 3D IP' },
  { id: 'person-main', group: 'real', kind: '主形象全身照', name: '真人 IP · 主形象', note: '标准全身照' },
  { id: 'person-views', group: 'real', kind: '三视图', name: '真人 IP · 三视图', note: '正面 / 侧面 / 背面' },
  { id: 'person-face', group: 'real', kind: '面部特写', name: '真人 IP · 面部特写', note: '标准面部参考' },
  { id: 'person-clothes', group: 'real', kind: '服装', name: '真人 IP · 服装', note: '服装结构与配色' },
  { id: 'person-detail', group: 'real', kind: '细节特写', name: '真人 IP · 细节特写', note: '配饰与局部细节' },
]

export const BRANDS = ['朴邻', '研选家', '万科物业', '万科物业 × 朴里节', '万物云', '住这儿']
const LOGO_FILES = {
  '朴邻-彩色': '/material-library/pulin-color.png',
  '朴邻-反白': '/material-library/pulin-white.png',
  '研选家-彩色': '/material-library/yanxuanjia-color.png',
  '研选家-反白': '/material-library/yanxuanjia-white.png',
  '万科物业-反白': '/material-library/vanke-property-white.png',
  '万科物业 × 朴里节-彩色': '/material-library/vanke-please-day-color.png',
  '万科物业 × 朴里节-反白': '/material-library/vanke-please-day-white.png',
}
export const LOGO_ASSETS = BRANDS.flatMap((brand) => [
  { id: `${brand}-color`, brand, variant: '彩色', name: `${brand} · 彩色 Logo`, note: 'PNG 透明底', file: LOGO_FILES[`${brand}-彩色`] },
  { id: `${brand}-white`, brand, variant: '反白', name: `${brand} · 反白 Logo`, note: 'PNG 透明底', file: LOGO_FILES[`${brand}-反白`] },
])

export const MATERIAL_ASSETS = [...IP_ASSETS.map((a) => ({ ...a, type: 'ip' })), ...LOGO_ASSETS.map((a) => ({ ...a, type: 'logo' }))]
