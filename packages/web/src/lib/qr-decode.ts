import jsQR from 'jsqr'

// Decode a QR code from an uploaded image (desktop "scan" path, AIT-216 D-1).
// Phone cameras are tolerant of photos where the QR only occupies a small area,
// but jsQR is much less forgiving. Run a few cheap canvas passes before giving
// up: native BarcodeDetector when available, multiple scales, rotations, and
// center crops for camera photos.

type BarcodeDetectorResult = { rawValue?: string; rawData?: string }
type BarcodeDetectorInstance = {
  detect: (source: CanvasImageSource) => Promise<BarcodeDetectorResult[]>
}
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorInstance

const MAX_SCAN_SIZE = 1800
const SCAN_SIZES = [1400, 900, 520]
const ROTATIONS = [0, 90, 180, 270] as const
const CENTER_CROPS = [1, 0.82, 0.66, 0.5]

export async function decodeQrImage(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const nativeResult = await detectWithNativeBarcodeDetector(bitmap)
    if (nativeResult) return nativeResult

    for (const cropRatio of CENTER_CROPS) {
      for (const rotation of ROTATIONS) {
        for (const size of SCAN_SIZES) {
          const canvas = renderForScan(bitmap, { maxSize: size, rotation, cropRatio })
          const decoded = scanCanvas(canvas)
          if (decoded) return decoded
        }
      }
    }

    return null
  } finally {
    bitmap.close?.()
  }
}

async function detectWithNativeBarcodeDetector(bitmap: ImageBitmap): Promise<string | null> {
  const ctor = (globalThis as typeof globalThis & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector
  if (!ctor) return null

  try {
    const detector = new ctor({ formats: ['qr_code'] })
    const results = await detector.detect(bitmap)
    return results[0]?.rawValue || results[0]?.rawData || null
  } catch {
    return null
  }
}

function renderForScan(
  bitmap: ImageBitmap,
  options: { maxSize: number; rotation: 0 | 90 | 180 | 270; cropRatio: number },
): HTMLCanvasElement {
  const sourceWidth = bitmap.width
  const sourceHeight = bitmap.height
  const cropWidth = Math.max(1, Math.round(sourceWidth * options.cropRatio))
  const cropHeight = Math.max(1, Math.round(sourceHeight * options.cropRatio))
  const sx = Math.round((sourceWidth - cropWidth) / 2)
  const sy = Math.round((sourceHeight - cropHeight) / 2)
  const scale = Math.min(1, options.maxSize / Math.max(cropWidth, cropHeight, MAX_SCAN_SIZE))
  const width = Math.max(1, Math.round(cropWidth * scale))
  const height = Math.max(1, Math.round(cropHeight * scale))
  const rotated = options.rotation === 90 || options.rotation === 270

  const canvas = document.createElement('canvas')
  canvas.width = rotated ? height : width
  canvas.height = rotated ? width : height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return canvas

  ctx.imageSmoothingEnabled = false
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((options.rotation * Math.PI) / 180)
  ctx.drawImage(bitmap, sx, sy, cropWidth, cropHeight, -width / 2, -height / 2, width, height)
  return canvas
}

function scanCanvas(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx || canvas.width === 0 || canvas.height === 0) return null

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const result = jsQR(image.data, image.width, image.height, {
    inversionAttempts: 'attemptBoth',
  })
  return result?.data ?? null
}
