import { describe, expect, it } from 'vitest'
import { makeStreamSafe } from '../stream-safe-markdown'

describe('makeStreamSafe — A1: 基本不改动', () => {
  it('A1.1: 完整文本不变', () => {
    expect(makeStreamSafe('hello world')).toBe('hello world')
  })

  it('A1.2: 空字符串不变', () => {
    expect(makeStreamSafe('')).toBe('')
  })

  it('A1.3: 已闭合代码块不变', () => {
    const input = '```js\nconsole.log(1)\n```'
    expect(makeStreamSafe(input)).toBe(input)
  })

  it('A1.4: 已闭合粗体不变', () => {
    expect(makeStreamSafe('**bold** text')).toBe('**bold** text')
  })

  it('A1.5: 已闭合单反引号不变', () => {
    expect(makeStreamSafe('use `code` here')).toBe('use `code` here')
  })

  it('A1.6: 多个已闭合语法共存不变', () => {
    const input = '**a** `b` ```c```'
    expect(makeStreamSafe(input)).toBe(input)
  })
})

describe('makeStreamSafe — A2: 未闭合代码块', () => {
  it('A2.1: 未闭合代码块追加关闭符', () => {
    expect(makeStreamSafe('```js\nconsole.log(1)')).toBe('```js\nconsole.log(1)\n```')
  })

  it('A2.2: 一个闭合 + 一个未闭合追加关闭符', () => {
    expect(makeStreamSafe('```a```\ntext\n```b')).toBe('```a```\ntext\n```b\n```')
  })

  it('A2.3: 代码块内含反引号不变', () => {
    const input = '```\na`b\n```'
    expect(makeStreamSafe(input)).toBe(input)
  })

  it('A2.4: 闭合代码块后接未闭合', () => {
    expect(makeStreamSafe('```x```\ntext\n```y')).toBe('```x```\ntext\n```y\n```')
  })
})

describe('makeStreamSafe — A3: 未闭合单反引号', () => {
  it('A3.1: 未闭合单反引号追加关闭符', () => {
    expect(makeStreamSafe('use `foo')).toBe('use `foo`')
  })

  it('A3.2: 已闭合单反引号不变', () => {
    expect(makeStreamSafe('a `b` c')).toBe('a `b` c')
  })

  it('A3.3: 三反引号闭合，中间有单反引号不变', () => {
    const input = '```\n`inline`\n```'
    expect(makeStreamSafe(input)).toBe(input)
  })
})

describe('makeStreamSafe — A4: 未闭合粗体 **', () => {
  it('A4.1: 未闭合粗体追加关闭符', () => {
    expect(makeStreamSafe('this is **bold')).toBe('this is **bold**')
  })

  it('A4.2: 多对粗体偶数个不变', () => {
    expect(makeStreamSafe('**a** **b**')).toBe('**a** **b**')
  })

  it('A4.3: 奇数个粗体标记追加关闭符', () => {
    expect(makeStreamSafe('**a **b **c')).toBe('**a **b **c**')
  })
})

describe('makeStreamSafe — A5: 未闭合斜体 _', () => {
  it('A5.1: 未闭合斜体追加关闭符', () => {
    expect(makeStreamSafe('_italic text')).toBe('_italic text_')
  })

  it('A5.2: 已闭合斜体不变', () => {
    expect(makeStreamSafe('_ok_')).toBe('_ok_')
  })
})

describe('makeStreamSafe — A6: 未闭合删除线 ~~', () => {
  it('A6.1: 未闭合删除线追加关闭符', () => {
    expect(makeStreamSafe('~~deleted')).toBe('~~deleted~~')
  })

  it('A6.2: 已闭合删除线不变', () => {
    expect(makeStreamSafe('~~ok~~')).toBe('~~ok~~')
  })
})

describe('makeStreamSafe — A7: 未闭合链接 [', () => {
  it('A7.1: 未闭合方括号追加关闭符', () => {
    expect(makeStreamSafe('check [this link')).toBe('check [this link](#)')
  })

  it('A7.2: 已闭合方括号不变', () => {
    expect(makeStreamSafe('[text](url)')).toBe('[text](url)')
  })

  it('A7.3: 多个未闭合方括号各追加关闭符', () => {
    // Two [ → two ](#), second ] matches first [ forming [b](#)
    expect(makeStreamSafe('see [a and [b')).toBe('see [a and [b](#)](#)')
  })
})

describe('makeStreamSafe — A8: 不完整 HTML 实体', () => {
  it('A8.1: 不完整实体追加分号', () => {
    expect(makeStreamSafe('&amp')).toBe('&amp;')
  })

  it('A8.2: 不完整 alpha 实体追加分号', () => {
    expect(makeStreamSafe('text &alp')).toBe('text &alp;')
  })

  it('A8.3: 完整实体不变', () => {
    expect(makeStreamSafe('&amp;')).toBe('&amp;')
  })

  it('A8.4: & 后无字母不变', () => {
    expect(makeStreamSafe('a & b')).toBe('a & b')
  })
})

describe('makeStreamSafe — A9: 混合场景', () => {
  it('A9.1: 代码块 + 粗体同时未闭合', () => {
    expect(makeStreamSafe('**bold ```code')).toBe('**bold ```code\n```**')
  })

  it('A9.2: 全部已闭合不变', () => {
    const input = '**a** `b` ```c```'
    expect(makeStreamSafe(input)).toBe(input)
  })

  it('A9.3: 粗体 + 删除线 + 斜体同时未闭合', () => {
    // Closes in order: ** → ~~ → _
    expect(makeStreamSafe('**bold ~~strike _italic')).toBe('**bold ~~strike _italic**~~_')
  })
})

describe('makeStreamSafe — A10: 边界切割', () => {
  it('A10.1: 中文未闭合代码块', () => {
    expect(makeStreamSafe('```python\nprint(\'你好')).toBe('```python\nprint(\'你好\n```')
  })

  it('A10.2: emoji + 未闭合粗体', () => {
    expect(makeStreamSafe('Hello 🌍 **world')).toBe('Hello 🌍 **world**')
  })

  it('A10.3: surrogate pair 边界不崩', () => {
    expect(makeStreamSafe('𝌆 **bold')).toBe('𝌆 **bold**')
  })

  it('A10.4: 混合中日韩文字不崩', () => {
    expect(makeStreamSafe('こんにちは **世界')).toBe('こんにちは **世界**')
  })
})
