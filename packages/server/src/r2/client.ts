import type { AppConfig } from '../config'
import { logger } from '../logger'

export interface R2ClientResult {
  ok: boolean
  error?: string
}

interface PresignedUrlResult {
  uploadId: string
  url: string
  key: string
}

let s3Client: unknown = null
let r2Available = false
let r2Config: AppConfig['r2'] | null = null

export async function initR2(config: AppConfig): Promise<R2ClientResult> {
  r2Config = config.r2
  const { accountId, accessKeyId, secretAccessKey, bucket } = config.r2

  if (!accountId || !accessKeyId || !secretAccessKey) {
    logger.warn('R2 credentials not configured, presigned URL disabled')
    r2Available = false
    return { ok: true }
  }

  try {
    const { S3Client } = await import('@aws-sdk/client-s3')

    s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    })

    r2Available = true
    logger.info({ bucket }, 'R2 client initialized')
    return { ok: true }
  } catch (err) {
    logger.error({ err }, 'Failed to initialize R2 client')
    r2Available = false
    return { ok: false, error: String(err) }
  }
}

export async function createPresignedUrl(
  fileName: string,
  mime: string,
): Promise<PresignedUrlResult> {
  if (!r2Available) {
    throw new Error('R2 is not configured')
  }

  const { PutObjectCommand } = await import('@aws-sdk/client-s3')
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')

  const uploadId = crypto.randomUUID()
  const key = `uploads/${uploadId}/${fileName}`

  const command = new PutObjectCommand({
    Bucket: r2Config!.bucket,
    Key: key,
    ContentType: mime,
  })

  const url = await getSignedUrl(
    s3Client as InstanceType<
      typeof import('@aws-sdk/client-s3').S3Client
    >,
    command,
    { expiresIn: 3600 },
  )

  return { uploadId, url, key }
}

export function getPublicUrl(key: string): string {
  if (r2Config?.publicUrl) {
    return `${r2Config.publicUrl}/${key}`
  }
  return key
}

export function isR2Available(): boolean {
  return r2Available
}
