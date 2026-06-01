// Decode a QR code from an uploaded image (desktop "scan" path, AIT-216 D-1).
import jsQR from 'jsqr'

export async function decodeQrImage(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0)
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const result = jsQR(img.data, img.width, img.height)
    return result?.data ?? null
  } finally {
    bitmap.close?.()
  }
}
