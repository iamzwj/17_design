import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { reviewLogoAssets } from '../src/complianceLogoAssets.js'

test('logo findings offer existing files from the selected brand only', () => {
  const finding = { title: '品牌Logo存在变形', fix: '替换为标准Logo' }
  const logos = reviewLogoAssets('yanxuanjia', finding)
  assert.equal(logos.length, 2)
  for (const logo of logos) { assert.equal(logo.brand, '研选家'); assert.ok(fs.existsSync(new URL('../public'+logo.file, import.meta.url))) }
  assert.equal(reviewLogoAssets('vanke-property', finding).length, 1)
  assert.equal(reviewLogoAssets('yanxuanjia', { title: '价格未注明有效期' }).length, 0)
  assert.equal(reviewLogoAssets('unknown-brand', finding).length, 0)
})
