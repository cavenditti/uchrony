import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { modelSections, renderFormula } from '../src/components/model-formulas'

const guide = readFileSync(new URL('../docs/MATHEMATICS.md', import.meta.url), 'utf8')

test('every published guide equation renders with accessible MathML', () => {
  const sections = modelSections(guide)
  assert.ok(sections.length > 0)
  assert.equal(new Set(sections.map((section) => section.title)).size, sections.length)
  for (const section of sections) {
    const displays = [...section.body.matchAll(/\$\$([\s\S]*?)\$\$/g)]
    const prose = section.body.replace(/\$\$[\s\S]*?\$\$/g, '')
    const inlines = [...prose.matchAll(/\$([^$\n]+)\$/g)]
    assert.ok(displays.length || inlines.length, `${section.title} has no mathematical notation`)
    assert.equal(prose.replace(/\$[^$\n]+\$/g, '').includes('$'), false, `${section.title}: unclosed math`)
    for (const [matches, display] of [
      [displays, true],
      [inlines, false],
    ] as const) {
      for (const match of matches) {
        const html = renderFormula(match[1], display)
        assert.match(html, /<math[^>]*xmlns="http:\/\/www.w3.org\/1998\/Math\/MathML"/, section.title)
        assert.match(html, /annotation encoding="application\/x-tex"/, section.title)
        assert.doesNotMatch(html, /katex-error/, section.title)
      }
    }
  }
})

test('invalid TeX is rejected instead of silently publishing a broken formula', () => {
  assert.throws(() => renderFormula('\\frac{1}{'))
})
