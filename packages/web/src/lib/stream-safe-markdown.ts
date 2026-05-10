/**
 * Strip content inside balanced triple-backtick code blocks so that
 * inline syntax checks don't count characters inside fenced code.
 */
function stripCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, (match) => ' '.repeat(match.length))
}

/**
 * Pre-process streaming text to close unclosed markdown syntax.
 * Order matters: block-level first (code fences), then inline.
 * This prevents the markdown parser from consuming the rest of the
 * streaming buffer into an incomplete construct.
 */
export function makeStreamSafe(raw: string): string {
  let text = raw
  if (!text) return text

  // 1. Triple backtick code blocks: if odd count, append closing fence
  const fenceMatches = text.match(/```/g)
  if (fenceMatches && fenceMatches.length % 2 !== 0) {
    text += '\n```'
  }

  // For remaining inline checks, strip content inside code blocks
  const outsideCode = stripCodeBlocks(text)

  // 2. Single backtick (inline code): count standalone backticks outside code blocks
  const singleBacktickCount = (outsideCode.match(/(?<!`)`(?!`)/g) || []).length
  if (singleBacktickCount % 2 !== 0) {
    text += '`'
  }

  // 3. Bold (**): if odd count, append closing **
  const boldCount = (outsideCode.match(/\*\*/g) || []).length
  if (boldCount % 2 !== 0) {
    text += '**'
  }

  // 4. Strikethrough (~~): if odd count, append closing ~~
  const strikeCount = (outsideCode.match(/~~/g) || []).length
  if (strikeCount % 2 !== 0) {
    text += '~~'
  }

  // 5. Italic (_): count standalone _ not part of __, outside code blocks
  const withoutBoldUnderscore = outsideCode.replace(/__/g, '')
  const italicCount = (withoutBoldUnderscore.match(/_/g) || []).length
  if (italicCount % 2 !== 0) {
    text += '_'
  }

  // 6. Links: close unmatched [ with ](#)
  const openBracket = (outsideCode.match(/\[/g) || []).length
  const closeBracket = (outsideCode.match(/\]/g) || []).length
  if (openBracket > closeBracket) {
    for (let i = 0; i < openBracket - closeBracket; i++) {
      text += '](#)'
    }
  }

  // 7. Incomplete HTML entity: &alpha without trailing ;
  const entityMatch = outsideCode.match(/&[a-zA-Z]+$/)
  if (entityMatch) {
    text += ';'
  }

  return text
}
