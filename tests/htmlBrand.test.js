import test from 'node:test'
import assert from 'node:assert/strict'
import { embedHtmlBrand, htmlBrandAccent } from '../server/htmlBrand.js'

test('uses a named primary color from the published palette without guessing from another color', () => {
  assert.equal(htmlBrandAccent([{ text: '辅助色 #FF00AA' }, { text: '品牌主色：#1a2b3c' }]), '#1A2B3C')
  assert.equal(htmlBrandAccent([{ text: '辅助色 #FF00AA' }]), null)
})

test('embeds one official logo and leaves the Skill background and typography alone', () => {
  const html = '<html><head><style>body{background:#fff;font-family:serif}</style></head><body><header><!-- DGEN_BRAND_LOGO --></header><!-- DGEN_BRAND_LOGO --></body></html>'
  const output = embedHtmlBrand(html, { accent: '#1A2B3C', logo: 'data:image/png;base64,AAAA' })
  assert.match(output, /background:#fff;font-family:serif/)
  assert.match(output, /--dgen-brand-accent:#1A2B3C/)
  assert.match(output, /<header><img[^>]+src="data:image\/png;base64,AAAA"/)
  assert.equal(output.match(/<img/g).length, 1)
  assert.doesNotMatch(output, /DGEN_BRAND_LOGO/)
  assert.doesNotMatch(embedHtmlBrand(html, {}), /DGEN_BRAND_LOGO|<img/)
})
