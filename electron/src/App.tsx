import React, { useState, useEffect, useRef, useCallback } from 'react'
import { GifPicker, SelectedGif, toFileUrl } from './components/GifPicker'
import { BreakCanvas } from './components/BreakCanvas'
import { BgMode } from './hooks/useGifFrames'
import { usePostureDetection } from './hooks/usePostureDetection'
import { PostureCanvas } from './components/PostureCanvas'
import { StatsModal } from './components/StatsModal'

type TimerMode = 'work' | 'shortBreak' | 'longBreak'

const MODES = {
  work:       { duration: 25 * 60, label: 'FOCUS MODE',  color: '#39ff14', glow: 'rgba(57,255,20,0.4)'  },
  shortBreak: { duration:  5 * 60, label: 'SHORT BREAK', color: '#ff1493', glow: 'rgba(255,20,147,0.4)' },
  longBreak:  { duration: 15 * 60, label: 'LONG BREAK',  color: '#00ffff', glow: 'rgba(0,255,255,0.4)'  },
} satisfies Record<TimerMode, { duration: number; label: string; color: string; glow: string }>

const WORK_QUOTES = [
  'STAY ON TARGET...',
  'ENGAGE HYPERFOCUS!',
  'LEVEL UP: DEEP WORK!',
  '1UP COMBO: STAY FOCUSED!',
  'BOSS FIGHT: YOUR TASKS!',
  'NO CONTINUES — PUSH THROUGH!',
]
const BREAK_QUOTES = [
  'RECHARGE YOUR POWER BAR!',
  'REFILLING HP...',
  'REST IS A POWER-UP!',
  'PLAYER 1: REST MODE',
  'BONUS STAGE: RELAXATION!',
]

const R = 100
const C = 2 * Math.PI * R

declare global {
  interface Window {
    api?: {
      minimize:       () => void
      maximize:       () => void
      close:          () => void
      notify:         (title: string, body: string) => void
      beep:           () => void
      setAlwaysOnTop: (flag: boolean) => void
      setFullscreen:  (flag: boolean) => void
      copyGif:        (srcPath: string) => Promise<string>
      pickGifFiles:   () => Promise<string[]>
      readFile:       (path: string) => Promise<Uint8Array>
      removeBgFrame:  (data: Uint8Array) => Promise<Uint8Array>
      cacheRead:      (mediaPath: string) => Promise<Uint8Array | null>
      cacheWrite:     (mediaPath: string, pngData: Uint8Array) => Promise<void>
      cacheCount:     () => Promise<number>
      cacheClear:     () => Promise<void>
      showWindow:     () => void
      onSystemLock:    (cb: () => void) => () => void
      onSystemUnlock:  (cb: () => void) => () => void
      onSystemSuspend: (cb: () => void) => () => void
      onSystemResume:  (cb: () => void) => () => void
    }
  }
}

function fmt(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function loadJson<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback } catch { return fallback }
}

function today() { return new Date().toISOString().slice(0, 10) }

function loadDailySessions(): number {
  try {
    const raw = localStorage.getItem('ft_daily')
    if (!raw) return 0
    const { date, count } = JSON.parse(raw)
    return date === today() ? count : 0
  } catch { return 0 }
}

function saveDailySessions(n: number) {
  localStorage.setItem('ft_daily', JSON.stringify({ date: today(), count: n }))
}

export interface DayStat { date: string; sessions: number; focusMin: number }

export type Durations = { work: number; shortBreak: number; longBreak: number }
const DEFAULT_DURATIONS: Durations = { work: 25, shortBreak: 5, longBreak: 15 }
export function loadDurations(): Durations {
  try {
    const d = JSON.parse(localStorage.getItem('ft_durations') ?? 'null')
    if (d?.work && d?.shortBreak && d?.longBreak) return d
  } catch {}
  return DEFAULT_DURATIONS
}

export function loadHistory(): DayStat[] {
  try { return JSON.parse(localStorage.getItem('ft_history') ?? '[]') } catch { return [] }
}

function upsertHistory(sessions: number, focusMin: number) {
  const t = today()
  const h = loadHistory()
  const idx = h.findIndex(e => e.date === t)
  if (idx >= 0) { h[idx].sessions += sessions; h[idx].focusMin += focusMin }
  else h.push({ date: t, sessions, focusMin })
  const sorted = h.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30)
  localStorage.setItem('ft_history', JSON.stringify(sorted))
}


export default function App() {
  // ── Timer state ────────────────────────────────────────────────
  const [timeLeft, setTimeLeft]   = useState(() => loadDurations().work * 60)
  const [isRunning, setIsRunning] = useState(false)
  const [mode, setMode]           = useState<TimerMode>('work')
  const [sessions, setSessions]         = useState(() => parseInt(localStorage.getItem('ft_sessions') ?? '0', 10))
  const [dailySessions, setDailySessions] = useState(() => loadDailySessions())
  const [showBreak, setShowBreak] = useState(false)
  const [gifFailed, setGifFailed] = useState(false)
  const [quote, setQuote]         = useState(() => pick(WORK_QUOTES))
  const [flicker, setFlicker]     = useState(false)

  // ── GIF picker state ───────────────────────────────────────────
  const [showPicker, setShowPicker]   = useState(false)
  const [selectedGif, setSelectedGif] = useState<SelectedGif | null>(() => {
    const saved = loadJson<SelectedGif | null>('ft_gif', null)
    if (!saved?.path) return null
    // Only accept GIF/WEBP — drop old video entries saved before video support was removed
    if (!/\.(gif|webp)$/i.test(saved.path)) {
      localStorage.removeItem('ft_gif')
      return null
    }
    return { path: saved.path, url: toFileUrl(saved.path), name: saved.name }
  })
  const [bgMode, setBgMode]           = useState<BgMode>(() => (localStorage.getItem('ft_bgmode') as BgMode) ?? 'off')
  const [bgTolerance, setBgTolerance] = useState(() => parseInt(localStorage.getItem('ft_tol') ?? '40', 10))
  const [isPreview, setIsPreview]     = useState(false)
  const [showWarning, setShowWarning] = useState(false)
  const [warnCount, setWarnCount]     = useState(15)
  const pendingBreakRef = useRef<TimerMode | null>(null)

  const [cacheCount, setCacheCount] = useState(0)
  const [postureAlert, setPostureAlert] = useState(false)
  const [showPostureView, setShowPostureView] = useState(false)
  const [showStats, setShowStats]   = useState(false)
  const [durations, setDurations]   = useState<Durations>(loadDurations)
  const [postureSensitivity, setPostureSensitivity] = useState(
    () => parseInt(localStorage.getItem('ft_posture_sens') ?? '5', 10)
  )

  const handlePostureAlert = useCallback(() => {
    window.api?.notify('⚠ POSTURE ALERT', 'Bad posture for 30s — sit up straight!')
    // System beep via main process — works even when window is minimized/hidden
    window.api?.beep()
    setPostureAlert(true)
    // Restore and show the posture view so user can see their skeleton
    window.api?.showWindow()
    setShowPostureView(true)
    autoShownPostureRef.current = true
    // AudioContext fallback (may be suspended if window is in background)
    try {
      const ctx = new AudioContext()
      const playBeeps = () => {
        const beep = (t: number) => {
          const osc  = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.type = 'sine'
          osc.frequency.value = 880
          gain.gain.setValueAtTime(0.35, t)
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18)
          osc.start(t)
          osc.stop(t + 0.18)
        }
        beep(ctx.currentTime)
        beep(ctx.currentTime + 0.25)
      }
      if (ctx.state === 'suspended') ctx.resume().then(playBeeps).catch(() => {})
      else playBeeps()
    } catch {}
  }, [])

  const { status: postureStatus, videoRef: postureVideoRef, landmarksRef: postureLandmarksRef } =
    usePostureDetection(isRunning && mode === 'work', handlePostureAlert, postureSensitivity)

  const handlePostureSensitivity = (v: number) => {
    setPostureSensitivity(v)
    localStorage.setItem('ft_posture_sens', String(v))
  }

  // Auto-dismiss posture alert after 8s
  useEffect(() => {
    if (!postureAlert) return
    const t = setTimeout(() => setPostureAlert(false), 8000)
    return () => clearTimeout(t)
  }, [postureAlert])

  // Posture status notifications — fire on state transitions, not repeatedly
  const prevPostureRef      = useRef<typeof postureStatus>('off')
  const awayTimerRef        = useRef<ReturnType<typeof setTimeout> | null>(null)
  const goodTimerRef        = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoShownPostureRef = useRef(false)  // true when we auto-opened the posture view

  useEffect(() => {
    const prev = prevPostureRef.current
    prevPostureRef.current = postureStatus

    // Cancel pending away-timer if user is no longer away
    if (postureStatus !== 'away' && awayTimerRef.current) {
      clearTimeout(awayTimerRef.current)
      awayTimerRef.current = null
    }

    // Posture fixed → cancel any pending good-timer and start a new one
    if (postureStatus === 'good' && autoShownPostureRef.current) {
      if (goodTimerRef.current) clearTimeout(goodTimerRef.current)
      goodTimerRef.current = setTimeout(() => {
        // Still good after 4s — hide posture view and minimize
        if (autoShownPostureRef.current) {
          setShowPostureView(false)
          autoShownPostureRef.current = false
          window.api?.minimize()
        }
        goodTimerRef.current = null
      }, 4000)
    }

    // Posture went bad again — cancel the pending minimize
    if (postureStatus === 'bad' && goodTimerRef.current) {
      clearTimeout(goodTimerRef.current)
      goodTimerRef.current = null
    }

    if (postureStatus === prev) return  // no transition — no notification

    if (postureStatus === 'error') {
      window.api?.notify('📷 CAMERA STOPPED', 'Camera closed or disconnected. Posture tracking paused.')
    } else if (postureStatus === 'denied') {
      window.api?.notify('🚫 CAMERA DENIED', 'Allow camera access to enable posture tracking.')
    } else if (postureStatus === 'away' && (prev === 'good' || prev === 'bad')) {
      // Only notify if user WAS being tracked — not on first load
      awayTimerRef.current = setTimeout(() => {
        window.api?.notify('👀 SIT CLOSER', 'Posture not visible — move closer to camera.')
        awayTimerRef.current = null
      }, 30_000)
    }
  }, [postureStatus])

  useEffect(() => () => {
    if (awayTimerRef.current) clearTimeout(awayTimerRef.current)
    if (goodTimerRef.current)  clearTimeout(goodTimerRef.current)
  }, [])

  const endRef      = useRef<number | null>(null)
  const pausedAtRef = useRef<number | null>(null)
  const cfg    = MODES[mode]
  const modeDuration = durations[mode] * 60
  const progress  = ((modeDuration - timeLeft) / modeDuration) * 100
  const svgOffset = C - (progress / 100) * C

  // path passed to BreakCanvas/useGifFrames (raw OS path for IPC)
  // url used for plain <img> display (file:// URL)
  const activeGifPath = selectedGif?.path ?? ''
  const activeGifUrl  = selectedGif?.url  ?? ''

  // ── Persist running timer to localStorage (survives renderer reload) ──────
  useEffect(() => {
    if (isRunning && endRef.current !== null) {
      localStorage.setItem('ft_timer_snapshot', JSON.stringify({
        endTimestamp: endRef.current,
        mode,
        isRunning: true,
        showBreak,
      }))
    } else {
      localStorage.removeItem('ft_timer_snapshot')
    }
  }, [isRunning, mode, showBreak])

  // ── Restore on mount + react to system power events ──────────────────────
  useEffect(() => {
    // Restore if renderer reloaded while timer was running (e.g. screen lock reload)
    const raw = localStorage.getItem('ft_timer_snapshot')
    if (raw) {
      try {
        const snap = JSON.parse(raw) as {
          endTimestamp: number | null
          pausedAt?: number
          mode: TimerMode
          isRunning: boolean
          showBreak: boolean
        }
        if (snap.endTimestamp !== null) {
          const remaining = Math.round((snap.endTimestamp - Date.now()) / 1000)
          if (remaining > 0) {
            endRef.current = snap.endTimestamp
            setMode(snap.mode)
            setTimeLeft(remaining)
            setIsRunning(true)
            if (snap.showBreak) setShowBreak(true)
          } else {
            localStorage.removeItem('ft_timer_snapshot')
            endRef.current = null
            setMode(snap.mode)
            setTimeLeft(0)
            setIsRunning(false)
            setTimeout(() => onComplete(), 0)
          }
        }
      } catch { localStorage.removeItem('ft_timer_snapshot') }
    }

    // Unlock: renderer still alive, recalculate remaining from snapshot
    const offUnlock = window.api?.onSystemUnlock?.(() => {
      const r = localStorage.getItem('ft_timer_snapshot')
      if (!r) return
      try {
        const snap = JSON.parse(r) as { endTimestamp: number; mode: TimerMode; showBreak: boolean }
        const remaining = Math.round((snap.endTimestamp - Date.now()) / 1000)
        if (remaining > 0) {
          endRef.current = snap.endTimestamp
          setMode(snap.mode)
          setTimeLeft(remaining)
          setIsRunning(true)
          if (snap.showBreak) setShowBreak(true)
        } else {
          localStorage.removeItem('ft_timer_snapshot')
          endRef.current = null
          setIsRunning(false)
          setTimeLeft(0)
          setTimeout(() => onComplete(), 0)
        }
      } catch { localStorage.removeItem('ft_timer_snapshot') }
    })

    // Suspend (sleep/lid close): pause timer, save remaining seconds
    const offSuspend = window.api?.onSystemSuspend?.(() => {
      const r = localStorage.getItem('ft_timer_snapshot')
      if (r) {
        try {
          const snap = JSON.parse(r) as { endTimestamp: number; mode: TimerMode; showBreak: boolean }
          const remaining = Math.max(0, Math.round((snap.endTimestamp - Date.now()) / 1000))
          pausedAtRef.current = remaining
          localStorage.setItem('ft_timer_snapshot', JSON.stringify({
            endTimestamp: null,
            pausedAt: remaining,
            mode: snap.mode,
            isRunning: false,
            showBreak: snap.showBreak,
          }))
        } catch {}
      }
      endRef.current = null
      setIsRunning(false)
    })

    // Resume from sleep: restore paused time, leave stopped (user presses play)
    const offResume = window.api?.onSystemResume?.(() => {
      const r = localStorage.getItem('ft_timer_snapshot')
      if (!r) return
      try {
        const snap = JSON.parse(r) as { pausedAt?: number; mode: TimerMode; showBreak: boolean }
        if (typeof snap.pausedAt === 'number' && snap.pausedAt > 0) {
          setMode(snap.mode)
          setTimeLeft(snap.pausedAt)
          setIsRunning(false)
          if (snap.showBreak) setShowBreak(true)
          localStorage.removeItem('ft_timer_snapshot')
        }
      } catch { localStorage.removeItem('ft_timer_snapshot') }
    })

    return () => { offUnlock?.(); offSuspend?.(); offResume?.() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Init effects ───────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setFlicker(f => !f), 4000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    window.api?.cacheCount().then(n => setCacheCount(n ?? 0))
  }, [])

  // Escape closes preview
  useEffect(() => {
    if (!isPreview) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsPreview(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isPreview])

  // Fullscreen + always-on-top when overlay active
  useEffect(() => {
    const active = showBreak || isPreview
    window.api?.setFullscreen(active)
    window.api?.setAlwaysOnTop(active)
    if (!active) window.api?.cacheCount().then(n => setCacheCount(n ?? 0))
  }, [showBreak, isPreview])

  // ── Mode switching ─────────────────────────────────────────────
  const goMode = useCallback((m: TimerMode, auto = false, autoStart = false) => {
    const dur = durations[m] * 60
    if (autoStart) {
      endRef.current = Date.now() + dur * 1000
    } else {
      endRef.current = null
    }
    setIsRunning(autoStart)
    setMode(m)
    setTimeLeft(dur)

    if (m !== 'work' && auto) {
      setGifFailed(false)
      setShowBreak(true)
      setQuote(pick(BREAK_QUOTES))
    } else if (m === 'work') {
      setShowBreak(false)
      setQuote(pick(WORK_QUOTES))
    }
  }, [selectedGif, durations])

  const onComplete = useCallback(() => {
    window.api?.showWindow()
    if (mode === 'work') {
      const n = sessions + 1
      setSessions(n)
      localStorage.setItem('ft_sessions', String(n))
      const d = loadDailySessions() + 1
      setDailySessions(d)
      saveDailySessions(d)
      upsertHistory(1, durations.work)
      window.api?.notify('🎮 FOCUS COMPLETE!', 'Choose your break!')
      pendingBreakRef.current = 'shortBreak'   // default if countdown expires
      setWarnCount(15)
      setShowWarning(true)
      setIsRunning(false)
      endRef.current = null
    } else {
      window.api?.notify('⏰ BREAK OVER!', 'Back to the grind, Player 1!')
      goMode('work', false, true)   // auto-start next work session
    }
  }, [mode, sessions, goMode, durations])

  // ── Controls ───────────────────────────────────────────────────
  const toggle = () => {
    if (!isRunning) endRef.current = Date.now() + timeLeft * 1000
    else endRef.current = null
    setIsRunning(r => !r)
  }

  const reset = () => {
    setIsRunning(false)
    endRef.current = null
    setTimeLeft(modeDuration)
    localStorage.removeItem('ft_timer_snapshot')
  }

  const skipBreak = () => {
    setShowBreak(false)
    goMode('work')
  }

  const clearCache = async () => {
    await window.api?.cacheClear()
    setCacheCount(0)
  }

  const skipBreakWarning = () => {
    setShowWarning(false)
    pendingBreakRef.current = null
    goMode('work')
  }

  const pickBreak = (breakType: TimerMode) => {
    setShowWarning(false)
    pendingBreakRef.current = null
    goMode(breakType, true, true)   // show break overlay + auto-start timer
  }

  // ── Timer tick ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isRunning) return
    const id = setInterval(() => {
      const left = Math.max(0, Math.round(((endRef.current ?? 0) - Date.now()) / 1000))
      setTimeLeft(left)
      if (left === 0) {
        setIsRunning(false)
        endRef.current = null
        onComplete()
      }
    }, 250)
    return () => clearInterval(id)
  }, [isRunning, onComplete])

  // ── Warning countdown ─────────────────────────────────────────
  useEffect(() => {
    if (!showWarning) return
    if (warnCount <= 0) {
      setShowWarning(false)
      const pending = pendingBreakRef.current ?? 'shortBreak'
      pendingBreakRef.current = null
      goMode(pending, true, true)   // auto-start whichever break (default short)
      return
    }
    const t = setTimeout(() => setWarnCount(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [showWarning, warnCount, goMode])

  // ── Persistence helpers ────────────────────────────────────────
  const handleGifSelect = (gif: SelectedGif) => {
    setSelectedGif(gif)
    localStorage.setItem('ft_gif', JSON.stringify(gif))
  }

  const handleBgMode = (m: BgMode) => {
    setBgMode(m)
    localStorage.setItem('ft_bgmode', m)
  }

  const handleTolerance = (v: number) => {
    setBgTolerance(v)
    localStorage.setItem('ft_tol', String(v))
  }

  // ── Render helpers ─────────────────────────────────────────────
  const overlayActive = showBreak || isPreview

  const bgRemoved = bgMode !== 'off'

  function renderMedia() {
    if (!activeGifPath) {
      return (
        <div className="gif-fallback">
          <div className="fb-deco" style={{ color: cfg.color }}>▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓</div>
          <div
            className="fb-a"
            style={{ color: cfg.color, textShadow: `0 0 30px ${cfg.color}, 0 0 60px ${cfg.color}` }}
          >
            {cfg.label}
          </div>
          <div className="fb-time" style={{ color: '#fff', textShadow: `0 0 20px ${cfg.color}` }}>
            {fmt(timeLeft)}
          </div>
          <div className="fb-deco" style={{ color: cfg.color }}>▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓</div>
          <div className="fb-hint">pick a gif in settings for break screen</div>
        </div>
      )
    }

    const gifKey = `${activeGifPath}-${bgMode}-${bgTolerance}`

    if (bgRemoved) {
      return (
        <BreakCanvas
          key={gifKey}
          gifUrl={activeGifPath}
          bgMode={bgMode}
          tolerance={bgTolerance}
        />
      )
    }
    if (gifFailed) {
      return <div className="gif-fallback"><div className="fb-a">BREAK</div><div className="fb-b">TIME!</div></div>
    }
    return (
      <img
        src={activeGifUrl}
        className="gif-img"
        alt="break"
        onError={() => setGifFailed(true)}
      />
    )
  }

  // ── JSX ────────────────────────────────────────────────────────
  return (
    <>
      <div className="app" style={{ '--c': cfg.color, '--g': cfg.glow } as React.CSSProperties}>

        {/* Titlebar */}
        <div className="bar">
          <span className="bar-title">◈ POMODORO PET ◈</span>
          <div className="bar-btns">
            <button onClick={() => window.api?.minimize()}>—</button>
            <button onClick={() => window.api?.maximize()}>□</button>
            <button className="x-btn" onClick={() => window.api?.close()}>✕</button>
          </div>
        </div>

        <div className="body">

          {/* Title */}
          <h1 className={`title ${flicker ? 'flick' : ''}`} style={{ color: cfg.color }}>
            ▶ POMODORO PET ◀
          </h1>

          {/* HUD */}
          <div className="hud">
            <button className="btn-stats" onClick={() => setShowStats(true)}>
              ◈ STATS
            </button>
            <span className="hud-sep">║</span>
            <div className="hud-item">
              <span className="hud-lbl">SCORE</span>
              <span className="hud-val">{String(sessions).padStart(4, '0')}</span>
            </div>
            <span className="hud-sep">║</span>
            <div className="hud-item">
              <span className="hud-lbl">SETS</span>
              <span className="hud-val">{String(Math.floor(sessions / 4)).padStart(2, '0')}</span>
            </div>
            <span className="hud-sep">║</span>
            <div className="hud-item">
              <span className="hud-lbl">SET</span>
              <span className="hud-val">{sessions % 4 + 1}/4</span>
            </div>
            <span className="hud-sep">║</span>
            <div className="hud-item">
              <span className="hud-lbl">TODAY</span>
              <span className="hud-val">{String(dailySessions).padStart(2, '0')}</span>
            </div>
          </div>

          {/* Mode tabs */}
          <div className="tabs">
            {(['work', 'shortBreak', 'longBreak'] as TimerMode[]).map(m => (
              <button
                key={m}
                className={`tab ${mode === m ? 'tab-on' : ''}`}
                style={mode === m ? { color: MODES[m].color, borderColor: MODES[m].color } : {}}
                onClick={() => goMode(m)}
              >
                {m === 'work' ? 'WORK' : m === 'shortBreak' ? 'SHORT' : 'LONG'}
              </button>
            ))}
          </div>

          {/* Clock ring */}
          <div className="clock-wrap">
            <svg width="240" height="240" viewBox="0 0 240 240" style={{ position: 'absolute', top: 0, left: 0 }}>
              <circle cx="120" cy="120" r={R} fill="none" stroke="#111" strokeWidth="6" />
              <circle
                cx="120" cy="120" r={R}
                fill="none"
                stroke={cfg.color}
                strokeWidth="6"
                strokeLinecap="butt"
                strokeDasharray={C}
                strokeDashoffset={svgOffset}
                transform="rotate(-90 120 120)"
                style={{
                  filter: `drop-shadow(0 0 8px ${cfg.color})`,
                  transition: 'stroke-dashoffset 0.5s linear, stroke 0.5s',
                }}
              />
            </svg>
            <div className="clock-inner">
              <div className="clock-mode" style={{ color: cfg.color }}>{cfg.label}</div>
              <div
                className="clock-time"
                style={{ color: cfg.color, textShadow: `0 0 20px ${cfg.color}, 0 0 40px ${cfg.color}` }}
              >
                {fmt(timeLeft)}
              </div>
              <div className="clock-status">{isRunning ? '● RUNNING' : '○ IDLE'}</div>
            </div>
          </div>

          {/* Progress */}
          <div className="prog-track">
            <div
              className="prog-fill"
              style={{ width: `${progress}%`, background: cfg.color, boxShadow: `0 0 12px ${cfg.color}` }}
            />
            <span className="prog-txt">{Math.round(progress)}% COMPLETE</span>
          </div>

          {/* Timer controls */}
          <div className="controls">
            <button
              className="btn-main"
              style={{ borderColor: cfg.color, color: cfg.color, boxShadow: `0 0 20px ${cfg.glow}` }}
              onClick={toggle}
            >
              {isRunning ? '⏸ PAUSE' : '▶ START'}
            </button>
            <button className="btn-sec" onClick={reset}>↺ RESET</button>
          </div>

          {/* Posture status chip — only visible while focus timer is running */}
          {isRunning && mode === 'work' && postureStatus !== 'off' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="posture-chip" data-status={postureStatus}>
                {postureStatus === 'loading' && '◈ POSTURE: LOADING...'}
                {postureStatus === 'good'    && '◈ POSTURE: OK'}
                {postureStatus === 'bad'     && '◈ POSTURE: BAD!'}
                {postureStatus === 'away'    && '◈ POSTURE: AWAY'}
                {postureStatus === 'error'   && '◈ POSTURE: NO CAM'}
                {postureStatus === 'denied'  && '◈ POSTURE: DENIED'}
              </div>
              {(postureStatus === 'good' || postureStatus === 'bad' || postureStatus === 'away') && (
                <button className="btn-posture-view" onClick={() => setShowPostureView(true)}>
                  ◈ VIEW
                </button>
              )}
            </div>
          )}
          {isRunning && mode === 'work' && postureStatus !== 'off' && postureStatus !== 'loading' && (
            <div className="tol-row" style={{ width: 'min(300px, 80vw)' }}>
              <span className="tol-label">SENSITIVITY</span>
              <input
                type="range"
                min={1} max={10}
                value={postureSensitivity}
                onChange={e => handlePostureSensitivity(Number(e.target.value))}
                className="tol-slider"
              />
              <span className="tol-val">{postureSensitivity}</span>
            </div>
          )}

          {/* Tomatoes */}
          <div className="tomatoes">
            {Array.from({ length: 4 }, (_, i) => (
              <span
                key={i}
                className="tomato"
                style={{
                  opacity: i < sessions % 4 ? 1 : 0.18,
                  filter: i < sessions % 4 ? 'drop-shadow(0 0 6px #ff5733)' : 'none',
                }}
              >
                🍅
              </span>
            ))}
          </div>

          {/* ── GIF Panel ── */}
          <div className="gif-panel">
            <div className="gif-panel-left">
              {selectedGif ? (
                <>
                  <img src={selectedGif.url} className="gif-thumb" alt="selected gif" />
                  <div className="gif-panel-info">
                    <div className="gif-panel-name">{selectedGif.name.slice(0, 22)}</div>
                    <div className="gif-panel-sub">LOCAL GIF ● ACTIVE</div>
                  </div>
                </>
              ) : (
                <div className="gif-panel-empty">NO GIF SELECTED</div>
              )}
            </div>

            <div className="gif-panel-right">
              <button className="btn-gif" onClick={() => setShowPicker(true)}>
                {selectedGif ? '⚙ CHANGE' : '◈ PICK GIF'}
              </button>

              {selectedGif && (
                <button
                  className="btn-try"
                  onClick={() => setIsPreview(true)}
                  title="Preview how the break screen looks"
                >
                  ▶ TRY
                </button>
              )}
            </div>
          </div>

          {/* BG removal options */}
          <div className="bg-options">
            <div className="bg-mode-row">
              <span className="tol-label">BG REMOVE</span>
              {(['off', 'ai', 'colorkey'] as BgMode[]).map(m => (
                <button
                  key={m}
                  className={`btn-bgmode ${bgMode === m ? 'btn-bgmode-on' : ''}`}
                  onClick={() => handleBgMode(m)}
                >
                  {m === 'off' ? 'OFF' : m === 'ai' ? '✦ AI' : 'COLOR KEY'}
                </button>
              ))}
            </div>
            {bgMode === 'ai' && (
              <div className="bg-hint">AI removes bg precisely — first run downloads ~35MB model</div>
            )}
            {bgMode === 'ai' && (
              <div className="cache-row">
                <span className="cache-label">
                  {cacheCount > 0 ? `◈ ${cacheCount} CACHED` : '◈ NO CACHE'}
                </span>
                {cacheCount > 0 && (
                  <button className="btn-cache-clear" onClick={clearCache}>
                    ✕ CLEAR
                  </button>
                )}
              </div>
            )}
            {bgMode === 'colorkey' && (
              <div className="tol-row">
                <span className="tol-label">TOLERANCE</span>
                <input
                  type="range"
                  min={5}
                  max={100}
                  value={bgTolerance}
                  onChange={e => handleTolerance(Number(e.target.value))}
                  className="tol-slider"
                />
                <span className="tol-val">{bgTolerance}</span>
              </div>
            )}
          </div>

          <div className="quote">{quote}</div>
        </div>
      </div>

      {/* ── Break / Preview Overlay ── */}
      {overlayActive && (
        <div className="overlay">
          {/* Window controls on overlay */}
          <div className="ov-winbar">
            <button className="ov-win-btn" onClick={() => window.api?.minimize()} title="Minimize">—</button>
            <button className="ov-win-btn" onClick={() => window.api?.maximize()} title="Maximize">□</button>
            <button className="ov-win-btn ov-win-close" onClick={() => window.api?.close()} title="Close">✕</button>
          </div>

          {/* Media layer */}
          <div className={bgRemoved ? 'gif-layer-float' : 'gif-layer-bg'}>
            {renderMedia()}
          </div>

          <div className="ov-scan" />

          {/* Break HUD — hidden during preview so GIF is fully visible */}
          {!isPreview && (
            <div
              className="ov-hud"
              style={{ borderColor: cfg.color, boxShadow: `0 0 30px ${cfg.glow}` }}
            >
              <div className="ov-label" style={{ color: cfg.color }}>{cfg.label}</div>
              <div
                className="ov-time"
                style={{ color: '#fff', textShadow: `0 0 20px ${cfg.color}` }}
              >
                {fmt(timeLeft)}
              </div>
              <div className="ov-btns">
                <button
                  className="btn-main"
                  style={{ borderColor: cfg.color, color: cfg.color }}
                  onClick={toggle}
                >
                  {isRunning ? '⏸ PAUSE' : '▶ START BREAK'}
                </button>
              </div>
            </div>
          )}

          {/* Preview close — sits left of winbar */}
          {isPreview && (
            <button
              className="preview-corner-btn"
              onClick={() => setIsPreview(false)}
            >
              ✕ END PREVIEW
            </button>
          )}
        </div>
      )}

      {/* ── Pre-break Warning ── */}
      {showWarning && (
        <div className="warn-overlay">
          <div className="warn-box">
            <div className="warn-title">◈ FOCUS SESSION COMPLETE ◈</div>
            <div className="warn-label">AUTO-STARTING IN</div>
            <div className="warn-count">{warnCount}</div>
            <div className="warn-sub">seconds (short break)</div>
            <div className="warn-break-btns">
              <button
                className="btn-break-pick"
                style={{ borderColor: MODES.shortBreak.color, color: MODES.shortBreak.color }}
                onClick={() => pickBreak('shortBreak')}
              >
                ⏱ SHORT BREAK
              </button>
              <button
                className="btn-break-pick"
                style={{ borderColor: MODES.longBreak.color, color: MODES.longBreak.color }}
                onClick={() => pickBreak('longBreak')}
              >
                ☕ LONG BREAK
              </button>
            </div>
            <button className="btn-skip-warn" onClick={skipBreakWarning}>
              ⏭ SKIP BREAK
            </button>
          </div>
        </div>
      )}

      {/* ── Stats Modal ── */}
      {showStats && (
        <StatsModal
          onClose={() => setShowStats(false)}
          durations={durations}
          onDurationsChange={(d) => {
            setDurations(d)
            localStorage.setItem('ft_durations', JSON.stringify(d))
            if (!isRunning) setTimeLeft(d[mode] * 60)
          }}
        />
      )}

      {/* ── GIF Picker Modal ── */}
      {showPicker && (
        <GifPicker
          onSelect={handleGifSelect}
          onClose={() => setShowPicker(false)}
        />
      )}

      {/* ── Posture View (fullscreen) ── */}
      {showPostureView && (
        <div className="posture-view-full">
          {/* Top bar */}
          <div className="posture-view-topbar">
            <span className="posture-view-title">◈ POSTURE CAM</span>
            <div
              className="posture-view-time"
              style={{ color: cfg.color, textShadow: `0 0 12px ${cfg.color}, 0 0 24px ${cfg.color}` }}
            >
              {fmt(timeLeft)}
            </div>
            <button
              className="ov-win-btn ov-win-close"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              onClick={() => { setShowPostureView(false); autoShownPostureRef.current = false }}
            >
              ✕
            </button>
          </div>

          {/* Canvas fills remaining space */}
          <div className="posture-view-canvas-wrap">
            <PostureCanvas
              videoRef={postureVideoRef}
              landmarksRef={postureLandmarksRef}
              status={postureStatus}
            />
          </div>

          {/* Status bar */}
          <div className="posture-view-status" data-status={postureStatus}>
            {postureStatus === 'good'    && '● POSTURE OK'}
            {postureStatus === 'bad'     && '⚠ BAD POSTURE — SIT UP STRAIGHT!'}
            {postureStatus === 'away'    && '○ NO PERSON DETECTED'}
            {postureStatus === 'loading' && '... LOADING CAMERA'}
          </div>
        </div>
      )}

      {/* ── Posture Alert ── */}
      {postureAlert && (
        <div className="posture-alert" onClick={() => setPostureAlert(false)}>
          <div className="posture-alert-box" onClick={e => e.stopPropagation()}>
            <div className="posture-alert-icon">⚠</div>
            <div className="posture-alert-title">BAD POSTURE!</div>
            <div className="posture-alert-sub">
              SIT UP STRAIGHT, PLAYER 1!<br />
              BACK STRAIGHT ● SHOULDERS BACK
            </div>
            <button className="btn-posture-ok" onClick={() => setPostureAlert(false)}>
              ✓ FIXED!
            </button>
          </div>
        </div>
      )}
    </>
  )
}
