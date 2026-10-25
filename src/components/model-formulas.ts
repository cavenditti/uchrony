import katex from 'katex'

/** Only repository-authored TeX enters this renderer; HTML/link extensions stay disabled. */
export function renderFormula(source: string, displayMode = false) {
  return katex.renderToString(source, {
    displayMode,
    output: 'htmlAndMathml',
    throwOnError: true,
    strict: 'error',
    trust: false,
  })
}

export function modelSections(reference: string) {
  return reference
    .split(/^## /m)
    .slice(1)
    .map((text) => {
      const end = text.indexOf('\n')
      return { title: text.slice(0, end), body: text.slice(end + 1).trim() }
    })
}
