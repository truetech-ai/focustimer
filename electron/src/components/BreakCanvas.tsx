import React, { useRef, useEffect } from 'react'
import { useGifFrames, BgMode } from '../hooks/useGifFrames'

interface Props {
  gifUrl: string
  bgMode: BgMode
  tolerance: number
}

export function BreakCanvas({ gifUrl, bgMode, tolerance }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const offRef    = useRef<HTMLCanvasElement | null>(null)
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { gifInfo, loading, status, error } = useGifFrames(gifUrl, bgMode, tolerance)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !gifInfo || gifInfo.frames.length === 0) return

    const ctx = canvas.getContext('2d')!
    canvas.width  = gifInfo.width
    canvas.height = gifInfo.height

    if (!offRef.current) offRef.current = document.createElement('canvas')
    const off    = offRef.current
    off.width    = gifInfo.width
    off.height   = gifInfo.height
    const offCtx = off.getContext('2d')!

    let frameIdx = 0

    function drawFrame() {
      const frame = gifInfo!.frames[frameIdx]
      if (frame.disposalType === 2)
        offCtx.clearRect(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height)
      offCtx.putImageData(frame.imageData, frame.dims.left, frame.dims.top)
      ctx.clearRect(0, 0, gifInfo!.width, gifInfo!.height)
      ctx.drawImage(off, 0, 0)
      frameIdx = (frameIdx + 1) % gifInfo!.frames.length
      timerRef.current = setTimeout(drawFrame, frame.delay)
    }

    drawFrame()
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [gifInfo])

  if (loading) {
    return (
      <div className="canvas-status">
        <div className="canvas-spinner">{status || 'LOADING...'}</div>
        {status.includes('model') && (
          <div className="canvas-hint">first run only — cached after download</div>
        )}
      </div>
    )
  }

  if (error) {
    return <div className="canvas-status canvas-err">FAILED — {error}</div>
  }

  // canvas fills its container while preserving aspect ratio
  return (
    <canvas
      ref={canvasRef}
      style={{ maxWidth: '100%', maxHeight: '100%', display: 'block', objectFit: 'contain' }}
    />
  )
}
