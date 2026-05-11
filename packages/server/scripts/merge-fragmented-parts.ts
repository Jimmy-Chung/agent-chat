import Database from 'better-sqlite3'
import path from 'path'

const dbPath = process.env.DB_PATH || './data/agent-chat.db'
const db = new Database(path.resolve(dbPath))

// Find messages with fragmented text/thinking parts (multiple parts per message+kind)
const fragmented = db
  .prepare(
    `SELECT mp.message_id, mp.kind, COUNT(*) as cnt
     FROM message_parts mp
     JOIN messages m ON m.id = mp.message_id
     WHERE m.role = 'assistant' AND mp.kind IN ('text', 'thinking')
     GROUP BY mp.message_id, mp.kind
     HAVING cnt > 1
     ORDER BY cnt DESC`,
  )
  .all() as Array<{ message_id: string; kind: string; cnt: number }>

console.log(`Found ${fragmented.length} fragmented (message_id, kind) pairs`)

let totalDeleted = 0
let totalMerged = 0

const mergeStmt = db.prepare(
  `UPDATE message_parts SET content_json = ? WHERE id = ?`,
)
const deleteStmt = db.prepare(
  `DELETE FROM message_parts WHERE id = ?`,
)

for (const frag of fragmented) {
  const parts = db
    .prepare(
      `SELECT id, content_json, ordinal
       FROM message_parts
       WHERE message_id = ? AND kind = ?
       ORDER BY ordinal ASC`,
    )
    .all(frag.message_id, frag.kind) as Array<{
    id: string
    content_json: string
    ordinal: number
  }>

  if (parts.length <= 1) continue

  // Concatenate all content fields in ordinal order
  let mergedContent = ''
  for (const p of parts) {
    try {
      const data = JSON.parse(p.content_json)
      if (typeof data.content === 'string') {
        mergedContent += data.content
      }
    } catch {
      // Keep raw if not parseable
      mergedContent += p.content_json
    }
  }

  // Update the first part with merged content, preserving the original structure
  const firstPart = parts[0]
  try {
    const firstData = JSON.parse(firstPart.content_json)
    firstData.content = mergedContent
    mergeStmt.run(JSON.stringify(firstData), firstPart.id)
  } catch {
    mergeStmt.run(mergedContent, firstPart.id)
  }

  // Delete the rest
  for (let i = 1; i < parts.length; i++) {
    deleteStmt.run(parts[i].id)
  }

  totalDeleted += parts.length - 1
  totalMerged++
}

console.log(`Merged ${totalMerged} groups, deleted ${totalDeleted} duplicate parts`)
console.log('Done.')
