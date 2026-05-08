import { z } from 'zod'

export const wsFrameSchema = z.object({
  v: z.literal(1),
  t: z.string(),
  d: z.unknown(),
  id: z.string().optional(),
  seq: z.number().optional(),
})

export type WSFrame = z.infer<typeof wsFrameSchema>

export function encodeFrame(frame: WSFrame): string {
  return JSON.stringify(frame)
}

export function decodeFrame(raw: string): WSFrame {
  const parsed = JSON.parse(raw)
  return wsFrameSchema.parse(parsed)
}

export function createFrame(
  t: string,
  d: unknown,
  id?: string,
  seq?: number,
): WSFrame {
  const frame: WSFrame = { v: 1, t, d }
  if (id !== undefined) {
    frame.id = id
  }
  if (seq !== undefined) {
    frame.seq = seq
  }
  return frame
}
