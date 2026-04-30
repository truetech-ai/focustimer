import { useEffect, useState } from 'react'
import { parseGIF, decompressFrames } from 'gifuct-js'

export interface ProcessedFrame {
  imageData: ImageData
  dims: { width: number; height: number; left: number; top: number }
  delay: number
  disposalType: number
}

export interface GifInfo {
  frames: ProcessedFrame[]
  width: number
  height: number
}

export type BgMode = 'ai' | 'colorkey' | 'off'

// ── Helpers ────────────────────────────────────────────────────────────────

function isLocalPath(url: string): boolean {
  return !url.startsWith('http') && !url.startsWith('data:') && !url.startsWith('./')
}

async function loadBuffer(url: string): Promise<ArrayBuffer> {
  if (isLocalPath(url)) {
    if (!window.api?.readFile) throw new Error('readFile IPC not available')
    const bytes = await window.api.readFile(url) as Uint8Array
    return new Uint8Array(bytes).buffer
  }
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.arrayBuffer()
}

// Composite frame onto a full-GIF-sized canvas and return as PNG ArrayBuffer
function frameToPNG(
  patch: Uint8ClampedArray,
  dims: ProcessedFrame['dims'],
  gifW: number,
  gifH: number
): Promise<ArrayBuffer> {
  const canvas = document.createElement('canvas')
  canvas.width = gifW
  canvas.height = gifH
  const ctx = canvas.getContext('2d')!
  ctx.putImageData(new ImageData(new Uint8ClampedArray(patch), dims.width, dims.height), dims.left, dims.top)
  return new Promise(resolve =>
    canvas.toBlob(blob => blob!.arrayBuffer().then(resolve), 'image/png')
  )
}

// Load a PNG ArrayBuffer into ImageData via an offscreen canvas
async function pngToImageData(buf: ArrayBuffer, w: number, h: number): Promise<ImageData> {
  const blob = new Blob([buf], { type: 'image/png' })
  const url  = URL.createObjectURL(blob)
  const img  = new Image()
  await new Promise<void>(res => { img.onload = () => res(); img.src = url })
  URL.revokeObjectURL(url)
  const canvas = document.createElement('canvas')
  canvas.width  = img.naturalWidth  || w
  canvas.height = img.naturalHeight || h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

// Apply alpha channel from maskData to every frame's patch in-place
function applyMaskToFrames(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawFrames: any[],
  maskData: ImageData,
  gifW: number,
  gifH: number
): ProcessedFrame[] {
  return rawFrames.map(f => {
    const out = new Uint8ClampedArray(f.patch as Uint8ClampedArray)
    const { left, top, width, height } = f.dims
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const srcIdx  = (row * width + col) * 4
        const maskIdx = ((top + row) * gifW + (left + col)) * 4
        if (maskIdx + 3 < maskData.data.length) {
          out[srcIdx + 3] = maskData.data[maskIdx + 3]
        }
      }
    }
    return {
      imageData:   new ImageData(out, width, height),
      dims:        f.dims,
      delay:       Math.max(((f.delay as number) ?? 10) * 10, 50),
      disposalType: (f.disposalType as number) ?? 0,
    }
  })
}

// Color-key fallback (existing math approach)
function colorKeyFrames(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawFrames: any[],
  tolerance: number
): ProcessedFrame[] {
  const first = rawFrames[0].patch as Uint8ClampedArray
  const bg: [number, number, number] = [first[0], first[1], first[2]]
  return rawFrames.map(f => {
    const src = f.patch as Uint8ClampedArray
    const out = new Uint8ClampedArray(src)
    for (let i = 0; i < out.length; i += 4) {
      const dr = out[i] - bg[0], dg = out[i+1] - bg[1], db = out[i+2] - bg[2]
      if (Math.sqrt(dr*dr + dg*dg + db*db) < tolerance) out[i+3] = 0
    }
    return {
      imageData:    new ImageData(out, f.dims.width, f.dims.height),
      dims:         f.dims,
      delay:        Math.max(((f.delay as number) ?? 10) * 10, 50),
      disposalType: (f.disposalType as number) ?? 0,
    }
  })
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useGifFrames(
  url: string | null,
  bgMode: BgMode,
  tolerance: number
) {
  const [gifInfo,   setGifInfo]   = useState<GifInfo | null>(null)
  const [loading,   setLoading]   = useState(false)
  const [status,    setStatus]    = useState('')   // human-readable progress
  const [error,     setError]     = useState<string | null>(null)

  useEffect(() => {
    if (!url) { setGifInfo(null); return }
    setLoading(true)
    setError(null)
    setGifInfo(null)
    setStatus('LOADING GIF...')

    let cancelled = false

    ;(async () => {
      const buf    = await loadBuffer(url)
      if (cancelled) return

      const parsed   = parseGIF(buf)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw      = decompressFrames(parsed, true) as any[]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gifW     = (parsed as any).lsd.width  as number
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gifH     = (parsed as any).lsd.height as number

      if (!raw.length || !raw[0]?.patch) {
        throw new Error('not a valid GIF — re-pick the file in the panel')
      }

      let frames: ProcessedFrame[]

      if (bgMode === 'ai' && window.api?.removeBgFrame) {
        // ── AI path: one inference on frame 0, mask applied to all ──────
        let resultBuf: Uint8Array

        const cached = window.api.cacheRead ? await window.api.cacheRead(url) : null
        if (cancelled) return

        if (cached) {
          setStatus('LOADING FROM CACHE...')
          resultBuf = new Uint8Array(cached as ArrayBuffer)
        } else {
          setStatus('COMPOSITING FRAME...')
          const pngBuf = await frameToPNG(raw[0].patch, raw[0].dims, gifW, gifH)
          if (cancelled) return

          setStatus('AI PROCESSING... (first run downloads model ~35MB)')
          resultBuf = await window.api.removeBgFrame(new Uint8Array(pngBuf)) as Uint8Array
          if (cancelled) return

          if (window.api.cacheWrite) {
            await window.api.cacheWrite(url, new Uint8Array(resultBuf))
          }
        }

        setStatus('APPLYING MASK TO ALL FRAMES...')
        const maskData = await pngToImageData(new Uint8Array(resultBuf).buffer, gifW, gifH)
        frames = applyMaskToFrames(raw, maskData, gifW, gifH)

      } else if (bgMode === 'colorkey') {
        // ── Color-key fallback ───────────────────────────────────────────
        setStatus('COLOR KEYING...')
        frames = colorKeyFrames(raw, tolerance)

      } else {
        // ── No removal ──────────────────────────────────────────────────
        frames = raw.map(f => ({
          imageData:    new ImageData(new Uint8ClampedArray(f.patch), f.dims.width, f.dims.height),
          dims:         f.dims,
          delay:        Math.max(((f.delay as number) ?? 10) * 10, 50),
          disposalType: (f.disposalType as number) ?? 0,
        }))
      }

      if (!cancelled) {
        setGifInfo({ frames, width: gifW, height: gifH })
        setStatus('')
      }
    })()
      .catch(e => { if (!cancelled) setError(String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [url, bgMode, tolerance])

  return { gifInfo, loading, status, error }
}
