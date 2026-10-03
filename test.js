/* eslint-env jest */
'use strict'

const dedoupe = require('./')
const css = require('css')
const fs = require('fs')
const os = require('os')
const path = require('path')
const spawnSync = require('child_process').spawnSync

function rules (content) {
  return JSON.parse(JSON.stringify(css.parse(content), (key, value) => {
    return key === 'position' ? undefined : value
  })).stylesheet.rules
}

const preserved = [
  ['comment', '/* keep this comment */'],
  ['charset', '@charset "UTF-8";'],
  ['import', '@import url("https://example.invalid/theme.css") screen;'],
  ['namespace', '@namespace svg url("http://www.w3.org/2000/svg");'],
  ['media', '@media screen { /* nested */ .a { color: red; color: blue; } .a { margin: 0; } .empty {} }'],
  ['supports', '@supports (display: grid) { @media screen { .a { display: grid; } .a { display: block; } } }'],
  ['font-face', '@font-face { font-family: "Example"; src: url("font.woff"); /* keep */ font-weight: 400; }'],
  ['document', '@-moz-document url-prefix("https://example.invalid/") { .a { color: red; } .a { color: blue; } }'],
  ['keyframes', '@keyframes fade { from { opacity: 0; opacity: 0.1; } to { opacity: 1; } }'],
  ['vendor keyframes', '@-webkit-keyframes fade { 0%, 50% { opacity: 0; } 100% { opacity: 1; } }'],
  ['page', '@page :first { margin: 1cm; margin: 2cm; }'],
  ['host', '@host { .a { color: red; } .a { color: blue; } }'],
  ['custom media', '@custom-media --narrow (max-width: 30em);']
]

test('should export function', () => {
  expect(dedoupe).toBeDefined()
  expect(typeof dedoupe).toBe('function')
})

test('should remove duplicate', () => {
  expect(dedoupe('.float-right {float: right;}.float-right {float: right;}')).toBe(
    '.float-right{float:right}'
  )
})

test('should keep the existing last-property and selector-order behavior for plain rules', () => {
  expect(dedoupe('.a { color: red; color: blue; } .b { margin: 0; } .a { color: green; padding: 0; }')).toBe(
    '.a{color:green;padding:0}.b{margin:0}'
  )
})

test('should keep grouped selectors and declaration values', () => {
  expect(dedoupe('.a, .b { content: "a;b"; --custom: 1; } .a, .b { --custom: 2; }')).toBe(
    '.a,.b{content:"a;b";--custom:2}'
  )
})

test('should accept empty and whitespace-only stylesheets', () => {
  expect(dedoupe()).toBe('')
  expect(dedoupe('')).toBe('')
  expect(dedoupe(' \r\n\t ')).toBe('')
})

preserved.forEach(fixture => {
  test(`should preserve ${fixture[0]} source and parsed content`, () => {
    const output = dedoupe(fixture[1])
    expect(output).toBe(fixture[1])
    expect(rules(output)).toEqual(rules(fixture[1]))
  })
})

test('should keep charset, import and namespace before ordinary rules', () => {
  const header = preserved[1][1] + preserved[0][1] + preserved[2][1] + preserved[3][1]
  const output = dedoupe(header + '.a { color: red; } .a { color: blue; }')
  expect(output).toBe(header + '.a{color:blue}')
  expect(rules(output).map(rule => rule.type)).toEqual(['charset', 'comment', 'import', 'namespace', 'rule'])
  expect(rules(output)).toEqual(rules(header + '.a { color: blue; }'))
})

test('should dedupe independently on either side of non-rule barriers', () => {
  const media = '@media screen { .a { color: blue; } }'
  const source = '.a { color: black; } .a { color: red; }' + media +
    '.a { color: green; } .a { color: orange; }'
  const expected = '.a{color:red}' + media + '.a{color:orange}'
  expect(dedoupe(source)).toBe(expected)
  expect(rules(dedoupe(source))).toEqual(rules(expected))
})

test('should not move a rule across a later conditional override', () => {
  const source = '.a { color: red; } @media screen { .a { color: blue; } } .a { margin: 0; }'
  const expected = '.a{color:red}@media screen { .a { color: blue; } }.a{margin:0}'
  expect(dedoupe(source)).toBe(expected)
  expect(rules(dedoupe(source))).toEqual(rules(source))
})

test('should preserve every node in a mixed stylesheet in order', () => {
  const nodes = [1, 0, 2, 3].map(index => preserved[index][1])
  preserved.slice(4).forEach((fixture, index) => {
    nodes.push(`.rule-${index} { color: red; }`, fixture[1])
  })
  nodes.push('/* final */')
  const source = nodes.join('\n')
  expect(rules(dedoupe(source))).toEqual(rules(source))
})

test('should preserve source offsets with CRLF, Unicode and leading whitespace', () => {
  const comment = '/* 😀 café\r\n   second line */'
  const media = '@media screen {\r\n  /* 🎨 */\r\n  .a { content: "é😀"; }\r\n  .empty {}\r\n}'
  const source = '\r\n \t' + comment + '\r\n\t.a { color: red; }\r\n  ' + media + '\r\n .b { color: blue; }'
  expect(dedoupe(source)).toBe(comment + '.a{color:red}' + media + '.b{color:blue}')
  expect(rules(dedoupe(source))).toEqual(rules(source))
})

test('should preserve commented rules instead of creating undefined properties', () => {
  const commented = '.a { color: red; /* keep position */ color: blue; }'
  const source = '.a { margin: 0; }' + commented + '.a { padding: 0; }'
  expect(dedoupe(source)).toBe('.a{margin:0}' + commented + '.a{padding:0}')
  expect(dedoupe(source)).not.toMatch(/undefined/)
  expect(rules(dedoupe(source))).toEqual(rules(source))
})

test('should preserve comment-only rules and consecutive comments', () => {
  const source = '/* first *//* second */.a { /* only a comment */ }/* last */'
  expect(dedoupe(source)).toBe(source)
  expect(rules(dedoupe(source))).toEqual(rules(source))
})

test('should propagate the original parser error', () => {
  const source = '@media screen { .a { color: red; }'
  let original
  try {
    css.parse(source)
  } catch (error) {
    original = error
  }
  expect(original).toBeDefined()
  try {
    dedoupe(source)
    throw new Error('Expected a parser error')
  } catch (error) {
    expect(error.message).toBe(original.message)
    expect(error.reason).toBe(original.reason)
    expect(error.line).toBe(original.line)
    expect(error.column).toBe(original.column)
    expect(error.source).toBe(original.source)
  }
})

describe('CLI', () => {
  let directory
  let input
  let output
  const source = '@charset "UTF-8";/* keep */.a { color: red; }.a { color: blue; }' +
    '@media screen { .a { color: green; } }.a { margin: 0; }'

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'css-dedoupe-test-'))
    input = path.join(directory, 'input.css')
    output = path.join(directory, 'output.css')
    fs.writeFileSync(input, source)
  })

  afterEach(() => {
    fs.readdirSync(directory).forEach(file => fs.unlinkSync(path.join(directory, file)))
    fs.rmdirSync(directory)
  })

  function run (args) {
    return spawnSync(process.execPath, [path.join(__dirname, 'cli.js')].concat(args), { encoding: 'utf8' })
  }

  test('should preserve non-rules when writing a separate output file', () => {
    const result = run([input, output])
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(fs.readFileSync(input, 'utf8')).toBe(source)
    expect(fs.readFileSync(output, 'utf8')).toBe(dedoupe(source))
    expect(rules(fs.readFileSync(output, 'utf8'))).toEqual(rules(dedoupe(source)))
  })

  test('should preserve non-rules when rewriting the input file', () => {
    const result = run([input])
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(fs.readFileSync(input, 'utf8')).toBe(dedoupe(source))
  })

  test('should not replace an existing output when parsing fails', () => {
    fs.writeFileSync(input, '.a { color: red;')
    fs.writeFileSync(output, 'leave output unchanged')
    const result = run([input, output])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/missing/)
    expect(fs.readFileSync(output, 'utf8')).toBe('leave output unchanged')
  })
})
