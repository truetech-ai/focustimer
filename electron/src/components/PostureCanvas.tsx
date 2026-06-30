import React, { useRef, useEffect } from 'react'

const CONNECTIONS: [number, number][] = [
  [0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],
  [9,10],
  [11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],
  [12,14],[14,16],[16,18],[16,20],[16,22],[18,20],
  [11,23],[12,24],[23,24],
  [23,25],[24,26],[25,27],[26,28],
  [27,29],[28,30],[29,31],[30,32],[27,31],[28,32],
]

const LEFT_LM  = new Set([1,3,7,9,11,13,15,17,19,21,23,25,27,29,31])
const RIGHT_LM = new Set([2,4,6,8,10,12,14,16,18,20,22,24,26,28,30,32])

interface Props {
  videoRef:    React.RefObject<HTMLVideoElement | null>
  landmarksRef: React.RefObject<Array<{ x: number; y: number; visibility?: number }> | null>
  status: string
}

export function PostureCanvas({ videoRef, landmarksRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let raf: number

    function draw() {
      const canvas = canvasRef.current
      if (!canvas) { raf = requestAnimationFrame(draw); return }

      const ctx  = canvas.getContext('2d')!
      const wrap = canvas.parentElement
      const cw   = wrap?.clientWidth  ?? 640
      const ch   = wrap?.clientHeight ?? 480

      // Resize canvas to exactly fill container every frame
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width  = cw
        canvas.height = ch
      }

      ctx.fillStyle = '#000011'
      ctx.fillRect(0, 0, cw, ch)

      const video = videoRef.current
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        const vw = video.videoWidth
        const vh = video.videoHeight

        // Scale video to fill container, maintain aspect ratio
        const scale = Math.min(cw / vw, ch / vh)
        const dw = vw * scale
        const dh = vh * scale
        const dx = (cw - dw) / 2
        const dy = (ch - dh) / 2

        // Draw mirrored (selfie view)
        ctx.save()
        ctx.translate(cw - dx, dy)
        ctx.scale(-1, 1)
        ctx.drawImage(video, 0, 0, dw, dh)
        ctx.restore()

        const pts = landmarksRef.current
        if (pts) drawSkeleton(ctx, pts, dw, dh, dx, dy)
      } else {
        ctx.fillStyle = '#1a1a3a'
        ctx.font = `9px 'Press Start 2P', monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('LOADING CAMERA...', cw / 2, ch / 2)
      }

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [videoRef, landmarksRef])

  return <canvas ref={canvasRef} className="posture-view-canvas" />
}

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: Array<{ x: number; y: number; visibility?: number }>,
  w: number, h: number, ox: number, oy: number,
) {
  // Connections
  for (const [a, b] of CONNECTIONS) {
    const lA = landmarks[a]
    const lB = landmarks[b]
    if (!lA || !lB) continue
    const vis = Math.min(lA.visibility ?? 1, lB.visibility ?? 1)
    if (vis < 0.3) continue

    ctx.beginPath()
    ctx.moveTo(ox + (1 - lA.x) * w, oy + lA.y * h)
    ctx.lineTo(ox + (1 - lB.x) * w, oy + lB.y * h)
    ctx.strokeStyle = LEFT_LM.has(a) && LEFT_LM.has(b)
      ? '#39ff14'
      : RIGHT_LM.has(a) && RIGHT_LM.has(b)
        ? '#00ffff'
        : 'rgba(255,255,255,0.55)'
    ctx.lineWidth = 3
    ctx.globalAlpha = vis * 0.9
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  // Dots
  for (let i = 0; i < landmarks.length; i++) {
    const lm  = landmarks[i]
    const vis = lm.visibility ?? 1
    if (vis < 0.3) continue

    ctx.beginPath()
    ctx.arc(ox + (1 - lm.x) * w, oy + lm.y * h, i === 0 ? 7 : 4, 0, Math.PI * 2)
    ctx.fillStyle = LEFT_LM.has(i) ? '#39ff14' : RIGHT_LM.has(i) ? '#00ffff' : '#ffffff'
    ctx.globalAlpha = vis
    ctx.fill()
  }
  ctx.globalAlpha = 1
}
