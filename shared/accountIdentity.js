export const TEST_ACCOUNT_IDENTITIES = Object.freeze({
  'yanxuanjia@onewo.com': 'yanxuanjia',
  'pulin@onewo.com': 'pulin',
})

export const ACCOUNT_IDENTITY_LABELS = Object.freeze({
  marketing: '营销部',
  yanxuanjia: '严选家',
  pulin: '普林',
})

const IDENTITY_BRANDS = Object.freeze({ yanxuanjia: '研选家', pulin: '朴邻' })

export function testAccountIdentity(email) {
  return Object.hasOwn(TEST_ACCOUNT_IDENTITIES, email) ? TEST_ACCOUNT_IDENTITIES[email] : null
}

export function scopedBrand(user) {
  return Object.hasOwn(IDENTITY_BRANDS, user?.identity) ? IDENTITY_BRANDS[user.identity] : null
}

export function canViewBrand(user, brand) {
  const scope = scopedBrand(user)
  return Boolean(user) && (!scope || scope === brand)
}
