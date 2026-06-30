import { useEffect, useRef, useState } from 'react'

export type PostureStatus = 'off' | 'loading' | 'good' | 'bad' | 'away' | 'error' | 'denied'

const NOSE = 0
const LEFT_EAR = 7
const RIGHT_EAR = 8
const LEFT_SHOULDER = 11
const RIGHT_SHOULDER = 12
const CHECK_MS = 500
const BAD_THRESHOLD_MS = 30_000
const ALERT_COOLDOWN_MS = 60_000

function sensitivityToThresholds(s: number) {
  const t = (s - 1) / 9  // normalise 1-10 → 0-1
  return {
    head:     0.04 + t * 0.10,  // 0.04 (relaxed) → 0.14 (strict)
    shoulder: 0.08 + t * 0.12,  // 0.08 (relaxed) → 0.20 (strict)
  }
}

function analyzePosture(
  lm: Array<{ x: number; y: number; visibility?: number }>,
  headThr: number,
  shoulderThr: number,
): 'good' | 'bad' | 'away' {
  const ls   = lm[LEFT_SHOULDER]
  const rs   = lm[RIGHT_SHOULDER]
  const nose = lm[NOSE]

  // Need both shoulders + nose clearly visible — face alone = 'away'
  if ((ls?.visibility  ?? 0) < 0.6 || (rs?.visibility ?? 0) < 0.6) return 'away'
  if ((nose?.visibility ?? 0) < 0.5) return 'away'

  const shoulderMidY  = (ls.y + rs.y) / 2
  const shoulderWidth = Math.abs(ls.x - rs.x)

  // Signal 1: nose drops toward shoulder line (head drooping / C-back)
  const headTooLow = shoulderMidY - nose.y < headThr

  // Signal 2: shoulders roll forward = narrower width = C-back
  const shouldersTooNarrow = shoulderWidth < shoulderThr

  // Signal 3: ears drop toward shoulders (forward head posture from C-spine)
  //           only used when both ears are visible
  const lEar = lm[LEFT_EAR]
  const rEar = lm[RIGHT_EAR]
  const earsVisible = (lEar?.visibility ?? 0) > 0.5 && (rEar?.visibility ?? 0) > 0.5
  const earsTooLow  = earsVisible
    ? shoulderMidY - (lEar.y + rEar.y) / 2 < headThr * 1.6
    : false

  return headTooLow || earsTooLow || shouldersTooNarrow ? 'bad' : 'good'
}

export function usePostureDetection(enabled: boolean, onAlert: () => void, sensitivity = 5) {
  const [status, setStatus] = useState<PostureStatus>('off')
  const onAlertRef    = useRef(onAlert)
  const thresholdsRef = useRef(sensitivityToThresholds(sensitivity))
  const landmarkerRef = useRef<any>(null)
  const landmarksRef  = useRef<Array<{ x: number; y: number; visibility?: number }> | null>(null)
  const streamRef     = useRef<MediaStream | null>(null)
  const probeRef      = useRef<HTMLCanvasElement | null>(null)
  const videoRef      = useRef<HTMLVideoElement | null>(null)
  const intervalRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const badSinceRef   = useRef<number | null>(null)
  const lastAlertRef  = useRef(0)
  const cancelledRef  = useRef(false)

  useEffect(() => { onAlertRef.current = onAlert }, [onAlert])
  useEffect(() => { thresholdsRef.current = sensitivityToThresholds(sensitivity) }, [sensitivity])

  useEffect(() => {
    if (!enabled) {
      setStatus('off')
      return
    }

    cancelledRef.current = false
    setStatus('loading')

    async function init() {
      try {
        const { PoseLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
        if (cancelledRef.current) return

        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        )
        if (cancelledRef.current) return

        const landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        })
        if (cancelledRef.current) { landmarker.close(); return }
        landmarkerRef.current = landmarker

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240, facingMode: 'user' },
        })
        if (cancelledRef.current) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream

        // Camera physically covered / OS revokes access mid-session
        stream.getTracks().forEach(track => {
          track.onended = () => {
            if (!cancelledRef.current) {
              if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
              landmarksRef.current = null
              setStatus('error')
            }
          }
        })

        const video = document.createElement('video')
        video.srcObject = stream
        video.playsInline = true
        video.muted = true
        await video.play()
        if (cancelledRef.current) return
        videoRef.current = video

        const probe = document.createElement('canvas')
        probe.width = 4; probe.height = 4
        probeRef.current = probe

        setStatus('good')

        intervalRef.current = setInterval(() => {
          const vid = videoRef.current
          const lm = landmarkerRef.current
          if (!vid || !lm || vid.readyState < 2) return

          try {
            // Camera track dead (lid close / disconnect)
            const track = streamRef.current?.getVideoTracks()[0]
            if (!track || track.readyState !== 'live') {
              landmarksRef.current = null
              setStatus('error')
              return
            }

            // Black-frame check — physical camera cover blocks light, frames go dark
            const probe = probeRef.current!
            probe.getContext('2d')!.drawImage(vid, 0, 0, 4, 4)
            const px = probe.getContext('2d')!.getImageData(0, 0, 4, 4).data
            const brightness = Array.from(px).reduce((s, v) => s + v, 0) / px.length
            if (brightness < 12) {
              landmarksRef.current = null
              setStatus('away')
              return
            }

            const result = lm.detectForVideo(vid, performance.now())
            const pts = result.landmarks?.[0] ?? null
            landmarksRef.current = pts

            if (!pts) {
              setStatus('away')
              badSinceRef.current = null
              return
            }

            const { head, shoulder } = thresholdsRef.current
            const posture = analyzePosture(pts, head, shoulder)
            setStatus(posture)

            if (posture === 'bad') {
              if (badSinceRef.current === null) badSinceRef.current = Date.now()
              if (
                Date.now() - badSinceRef.current >= BAD_THRESHOLD_MS &&
                Date.now() - lastAlertRef.current > ALERT_COOLDOWN_MS
              ) {
                lastAlertRef.current = Date.now()
                onAlertRef.current()
              }
            } else {
              badSinceRef.current = null
            }
          } catch { /* frame error — skip */ }
        }, CHECK_MS)
      } catch (err: any) {
        if (cancelledRef.current) return
        setStatus(err?.name === 'NotAllowedError' ? 'denied' : 'error')
      }
    }

    init()

    return () => {
      cancelledRef.current = true
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
      try { landmarkerRef.current?.close() } catch {}
      landmarkerRef.current = null
      landmarksRef.current  = null
      videoRef.current      = null
      probeRef.current      = null
      badSinceRef.current   = null
    }
  }, [enabled])

  return { status, videoRef, landmarksRef }
}
