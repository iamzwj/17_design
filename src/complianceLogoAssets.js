import { LOGO_ASSETS } from '../shared/materialCatalog.js'
import { COMPLIANCE_BRANDS } from './complianceRules.js'

export function reviewLogoAssets(brand, item) {
  const text = [item.title, item.location, item.problem, item.fix].filter(Boolean).join(' ')
  if (!/logo|品牌标志|品牌标识/i.test(text)) return []
  const name = COMPLIANCE_BRANDS.find((entry) => entry.value === brand)?.label
  return LOGO_ASSETS.filter((asset) => asset.brand === name && asset.file)
}
