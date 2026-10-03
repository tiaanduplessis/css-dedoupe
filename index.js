'use strict'
const css = require('css')
const ToCSS = require('obj-to-css')

module.exports = function cssDedoupe (content = '') {
  const parsed = css.parse(content)
  const output = []
  const lineOffsets = [0]
  let declarations = []

  for (let index = 0; index < content.length; index++) {
    if (content[index] === '\n') lineOffsets.push(index + 1)
  }

  function flush () {
    const newDeclarations = declarations.reduce((acc, current) => {
      if (acc[current.selector]) {
        const newProps = Object.assign({}, acc[current.selector], current.value)
        return Object.assign({}, acc, { [current.selector]: newProps })
      }

      return Object.assign({}, acc, { [current.selector]: current.value })
    }, {})

    output.push(ToCSS(newDeclarations))
    declarations = []
  }

  parsed.stylesheet.rules.forEach(current => {
    // Preserve non-rules and commented rules without merging across them.
    if (current.type !== 'rule' || current.declarations.some(rule => rule.type !== 'declaration')) {
      flush()
      const { start, end } = current.position
      output.push(content.slice(
        lineOffsets[start.line - 1] + start.column - 1,
        lineOffsets[end.line - 1] + end.column - 1
      ))
      return
    }

    const value = {}
    const selector = current.selectors.join(',')

    current.declarations.forEach(rule => {
      value[rule.property] = rule.value
    })

    declarations.push({ selector, value })
  })

  flush()
  return output.join('')
}
