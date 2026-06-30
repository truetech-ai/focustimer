import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, StatusBar, Modal, Vibration, Platform, AppState, Image,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as DocumentPicker from 'expo-document-picker'
import * as Notifications from 'expo-notifications'
import {
  setupAndroidChannel, requestNotificationPermission,
  scheduleTimerNotification, cancelTimerNotification,
} from './notifications'

type TimerMode = 'work' | 'shortBreak' | 'longBreak'

const MODES = {
  work:       { duration: 25 * 60, label: 'FOCUS MODE',  color: '#39ff14' },
  shortBreak: { duration:  5 * 60, label: 'SHORT BREAK', color: '#ff1493' },
  longBreak:  { duration: 15 * 60, label: 'LONG BREAK',  color: '#00ffff' },
} satisfies Record<TimerMode, { duration: number; label: string; color: string }>

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

const FONT = Platform.OS === 'ios' ? 'Courier New' : 'monospace'

function fmt(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export default function App() {
  const [timeLeft, setTimeLeft]   = useState(MODES.work.duration)
  const [isRunning, setIsRunning] = useState(false)
  const [mode, setMode]           = useState<TimerMode>('work')
  const [sessions, setSessions]   = useState(0)
  const [showBreak, setShowBreak] = useState(false)
  const [showWarning, setShowWarning] = useState(false)
  const [warnCount, setWarnCount] = useState(15)
  const [quote, setQuote]         = useState(() => pick(WORK_QUOTES))
  const [flicker, setFlicker]     = useState(false)
  const [isPreview, setIsPreview] = useState(false)

  // GIF state
  const [gifUri, setGifUri]   = useState<string | null>(null)
  const [gifName, setGifName] = useState('')

  const endRef       = useRef<number | null>(null)
  const pendingBreak = useRef<TimerMode | null>(null)

  const cfg      = MODES[mode]
  const progress = ((cfg.duration - timeLeft) / cfg.duration) * 100

  // ── Persistence ───────────────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.multiGet(['pp_sessions', 'pp_gif_uri', 'pp_gif_name']).then(pairs => {
      const data = Object.fromEntries(pairs)
      if (data.pp_sessions) setSessions(parseInt(data.pp_sessions, 10))
      if (data.pp_gif_uri)  setGifUri(data.pp_gif_uri)
      if (data.pp_gif_name) setGifName(data.pp_gif_name)
    })
  }, [])

  // ── Notification channel + permission ────────────────────────────
  useEffect(() => {
    setupAndroidChannel()
    requestNotificationPermission()
  }, [])

  // ── Notification response (user tapped notification) ──────────────
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      AsyncStorage.getItem('pp_mode').then(savedMode => {
        const m = (savedMode as TimerMode) ?? 'work'
        endRef.current = null
        setIsRunning(false)
        if (m === 'work') {
          const n = sessions + 1
          setSessions(n)
          AsyncStorage.setItem('pp_sessions', String(n))
          Vibration.vibrate([0, 500, 200, 500])
          pendingBreak.current = 'shortBreak'
          setWarnCount(15)
          setShowWarning(true)
        } else {
          Vibration.vibrate([0, 500, 200, 500])
          goMode('work', false, true)
        }
      })
    })
    return () => sub.remove()
  }, [sessions, goMode]) // eslint-disable-line

  // ── Flicker title ─────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setFlicker(f => !f), 4000)
    return () => clearInterval(t)
  }, [])

  // ── App foreground resume ─────────────────────────────────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      if (nextState === 'active' && endRef.current && isRunning) {
        const left = Math.max(0, Math.round((endRef.current - Date.now()) / 1000))
        setTimeLeft(left)
        if (left === 0) {
          setIsRunning(false)
          endRef.current = null
          onComplete()
        }
      }
    })
    return () => sub.remove()
  }, [isRunning]) // eslint-disable-line

  // ── Mode switch ───────────────────────────────────────────────────
  const goMode = useCallback((m: TimerMode, auto = false, autoStart = false) => {
    const dur = MODES[m].duration
    endRef.current = autoStart ? Date.now() + dur * 1000 : null
    setIsRunning(autoStart)
    setMode(m)
    setTimeLeft(dur)

    cancelTimerNotification()
    if (autoStart && endRef.current) {
      const title = m === 'work' ? '🎮 FOCUS COMPLETE!' : '⏰ BREAK OVER!'
      const body  = m === 'work' ? 'Choose your break!' : 'Back to the grind!'
      scheduleTimerNotification(endRef.current, title, body)
      AsyncStorage.setItem('pp_mode', m)
    }

    if (m !== 'work' && auto) {
      setShowBreak(true)
      setQuote(pick(BREAK_QUOTES))
    } else if (m === 'work') {
      setShowBreak(false)
      setQuote(pick(WORK_QUOTES))
    }
  }, [])

  // ── Timer complete ────────────────────────────────────────────────
  const onComplete = useCallback(() => {
    cancelTimerNotification()
    if (Platform.OS !== 'web') Vibration.vibrate([0, 500, 200, 500])

    if (mode === 'work') {
      const n = sessions + 1
      setSessions(n)
      AsyncStorage.setItem('pp_sessions', String(n))
      pendingBreak.current = 'shortBreak'
      setWarnCount(15)
      setShowWarning(true)
      setIsRunning(false)
      endRef.current = null
    } else {
      goMode('work', false, true)
    }
  }, [mode, sessions, goMode])

  // ── Timer tick ────────────────────────────────────────────────────
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

  // ── Warning countdown ─────────────────────────────────────────────
  useEffect(() => {
    if (!showWarning) return
    if (warnCount <= 0) {
      setShowWarning(false)
      const pending = pendingBreak.current ?? 'shortBreak'
      pendingBreak.current = null
      goMode(pending, true, true)
      return
    }
    const t = setTimeout(() => setWarnCount(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [showWarning, warnCount, goMode])

  // ── Controls ──────────────────────────────────────────────────────
  const toggle = () => {
    if (!isRunning) {
      const end = Date.now() + timeLeft * 1000
      endRef.current = end
      setIsRunning(true)
      const title = mode === 'work' ? '🎮 FOCUS COMPLETE!' : '⏰ BREAK OVER!'
      const body  = mode === 'work' ? 'Choose your break!' : 'Back to the grind!'
      scheduleTimerNotification(end, title, body)
      AsyncStorage.setItem('pp_mode', mode)
    } else {
      endRef.current = null
      setIsRunning(false)
      cancelTimerNotification()
    }
  }

  const reset = () => {
    setIsRunning(false)
    endRef.current = null
    setTimeLeft(cfg.duration)
    cancelTimerNotification()
  }

  const pickBreak = (breakType: TimerMode) => {
    setShowWarning(false)
    pendingBreak.current = null
    goMode(breakType, true, true)
  }

  const skipBreakWarning = () => {
    setShowWarning(false)
    pendingBreak.current = null
    goMode('work')
  }

  const skipBreak = () => {
    setShowBreak(false)
    goMode('work')
  }

  // ── GIF picker ────────────────────────────────────────────────────
  const pickGif = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/gif', 'image/webp'],
        copyToCacheDirectory: true,
      })
      if (!result.canceled && result.assets.length > 0) {
        const asset = result.assets[0]
        setGifUri(asset.uri)
        setGifName(asset.name)
        await AsyncStorage.multiSet([
          ['pp_gif_uri', asset.uri],
          ['pp_gif_name', asset.name],
        ])
      }
    } catch {
      // user cancelled
    }
  }

  // ── Render ────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#000011" />

      <View style={s.body}>

        {/* Title */}
        <Text style={[s.title, { color: cfg.color, opacity: flicker ? 0.65 : 1 }]}>
          ▶ POMODORO PET ◀
        </Text>

        {/* HUD */}
        <View style={s.hud}>
          <View style={s.hudItem}>
            <Text style={s.hudLbl}>SCORE</Text>
            <Text style={s.hudVal}>{String(sessions).padStart(4, '0')}</Text>
          </View>
          <Text style={s.hudSep}>║</Text>
          <View style={s.hudItem}>
            <Text style={s.hudLbl}>SETS</Text>
            <Text style={s.hudVal}>{String(Math.floor(sessions / 4)).padStart(2, '0')}</Text>
          </View>
          <Text style={s.hudSep}>║</Text>
          <View style={s.hudItem}>
            <Text style={s.hudLbl}>SET</Text>
            <Text style={s.hudVal}>{sessions % 4 + 1}/4</Text>
          </View>
        </View>

        {/* Mode tabs */}
        <View style={s.tabs}>
          {(['work', 'shortBreak', 'longBreak'] as TimerMode[]).map(m => (
            <TouchableOpacity
              key={m}
              style={[s.tab, mode === m && { borderColor: MODES[m].color }]}
              onPress={() => goMode(m)}
            >
              <Text style={[s.tabTxt, mode === m && { color: MODES[m].color }]}>
                {m === 'work' ? 'WORK' : m === 'shortBreak' ? 'SHORT' : 'LONG'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Clock */}
        <View style={[s.clock, { borderColor: cfg.color }]}>
          <Text style={[s.clockMode, { color: cfg.color }]}>{cfg.label}</Text>
          <Text style={[s.clockTime, { color: cfg.color }]}>{fmt(timeLeft)}</Text>
          <Text style={s.clockStatus}>{isRunning ? '● RUNNING' : '○ IDLE'}</Text>
        </View>

        {/* Progress */}
        <View style={s.progTrack}>
          <View style={[s.progFill, { width: `${progress}%` as any, backgroundColor: cfg.color }]} />
          <Text style={s.progTxt}>{Math.round(progress)}% COMPLETE</Text>
        </View>

        {/* Controls */}
        <View style={s.controls}>
          <TouchableOpacity style={[s.btnMain, { borderColor: cfg.color }]} onPress={toggle}>
            <Text style={[s.btnMainTxt, { color: cfg.color }]}>
              {isRunning ? '⏸ PAUSE' : '▶ START'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.btnSec} onPress={reset}>
            <Text style={s.btnSecTxt}>↺ RESET</Text>
          </TouchableOpacity>
        </View>

        {/* Tomatoes */}
        <View style={s.tomatoes}>
          {Array.from({ length: 4 }, (_, i) => (
            <Text key={i} style={{ fontSize: 26, opacity: i < sessions % 4 ? 1 : 0.18 }}>
              🍅
            </Text>
          ))}
        </View>

        {/* GIF Panel */}
        <View style={s.gifPanel}>
          <View style={s.gifPanelLeft}>
            {gifUri ? (
              <>
                <Image source={{ uri: gifUri }} style={s.gifThumb} />
                <View style={s.gifInfo}>
                  <Text style={s.gifInfoName}>{gifName.slice(0, 18)}</Text>
                  <Text style={s.gifInfoSub}>LOCAL GIF ● ACTIVE</Text>
                </View>
              </>
            ) : (
              <Text style={s.gifEmpty}>NO GIF SELECTED</Text>
            )}
          </View>
          <View style={s.gifPanelRight}>
            <TouchableOpacity style={s.btnGif} onPress={pickGif}>
              <Text style={s.btnGifTxt}>{gifUri ? '⚙ CHANGE' : '◈ PICK GIF'}</Text>
            </TouchableOpacity>
            {gifUri && (
              <TouchableOpacity style={s.btnTry} onPress={() => setIsPreview(true)}>
                <Text style={s.btnTryTxt}>▶ TRY</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Quote */}
        <Text style={s.quote}>{quote}</Text>
      </View>

      {/* ── Break / Preview overlay ── */}
      <Modal visible={showBreak || isPreview} animationType="fade" statusBarTranslucent>
        <SafeAreaView style={s.breakScreen}>

          {gifUri ? (
            <Image source={{ uri: gifUri }} style={s.breakGif} resizeMode="cover" />
          ) : (
            <View style={s.gifFallback}>
              <Text style={[s.fbDeco, { color: cfg.color }]}>▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓</Text>
              <Text style={[s.fbLabel, { color: cfg.color }]}>{cfg.label}</Text>
              <Text style={[s.fbTime, { color: '#fff' }]}>{fmt(timeLeft)}</Text>
              <Text style={[s.fbDeco, { color: cfg.color }]}>▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓</Text>
              <Text style={s.fbHint}>pick a gif in settings for break screen</Text>
            </View>
          )}

          {/* Scan-line tint */}
          <View style={s.scanOverlay} pointerEvents="none" />

          {/* Break HUD — hidden in preview */}
          {!isPreview && (
            <View style={[s.breakHud, { borderColor: cfg.color }]}>
              <Text style={[s.breakLabel, { color: cfg.color }]}>{cfg.label}</Text>
              <Text style={s.breakTime}>{fmt(timeLeft)}</Text>
              <TouchableOpacity style={[s.btnMain, { borderColor: cfg.color }]} onPress={toggle}>
                <Text style={[s.btnMainTxt, { color: cfg.color }]}>
                  {isRunning ? '⏸ PAUSE' : '▶ START BREAK'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity
            style={s.endBtn}
            onPress={() => isPreview ? setIsPreview(false) : skipBreak()}
          >
            <Text style={s.endBtnTxt}>{isPreview ? '✕ END PREVIEW' : '✕'}</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </Modal>

      {/* ── Warning / break-pick modal ── */}
      <Modal visible={showWarning} animationType="fade" transparent statusBarTranslucent>
        <View style={s.warnOverlay}>
          <View style={s.warnBox}>
            <Text style={s.warnTitle}>◈ FOCUS SESSION COMPLETE ◈</Text>
            <Text style={s.warnLbl}>AUTO-STARTING IN</Text>
            <Text style={s.warnCount}>{warnCount}</Text>
            <Text style={s.warnSub}>seconds (short break)</Text>

            <View style={s.breakPickRow}>
              <TouchableOpacity
                style={[s.btnBreakPick, { borderColor: MODES.shortBreak.color }]}
                onPress={() => pickBreak('shortBreak')}
              >
                <Text style={[s.btnBreakPickTxt, { color: MODES.shortBreak.color }]}>
                  ⏱ SHORT BREAK
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.btnBreakPick, { borderColor: MODES.longBreak.color }]}
                onPress={() => pickBreak('longBreak')}
              >
                <Text style={[s.btnBreakPickTxt, { color: MODES.longBreak.color }]}>
                  ☕ LONG BREAK
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={s.btnSkip} onPress={skipBreakWarning}>
              <Text style={s.btnSkipTxt}>⏭ SKIP BREAK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000011' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: 20, paddingVertical: 8, backgroundColor: '#000011' },

  // Title
  title: { fontFamily: FONT, fontSize: 13, letterSpacing: 2, textAlign: 'center' },

  // HUD
  hud:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 8, borderWidth: 1, borderColor: '#0e0e1e', width: '100%', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)' },
  hudItem:{ alignItems: 'center' },
  hudLbl: { fontFamily: FONT, fontSize: 7, color: '#333', letterSpacing: 2 },
  hudVal: { fontFamily: FONT, fontSize: 13, color: '#ffd700', marginTop: 3 },
  hudSep: { color: '#1a1a1a', fontSize: 18, marginHorizontal: 14 },

  // Tabs
  tabs:   { flexDirection: 'row' },
  tab:    { paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#111', marginHorizontal: 3 },
  tabTxt: { fontFamily: FONT, fontSize: 7, color: '#2a2a2a', letterSpacing: 2 },

  // Clock
  clock:      { width: 210, height: 210, borderRadius: 105, borderWidth: 4, alignItems: 'center', justifyContent: 'center' },
  clockMode:  { fontFamily: FONT, fontSize: 7, letterSpacing: 2, marginBottom: 6 },
  clockTime:  { fontFamily: FONT, fontSize: 32, letterSpacing: 3 },
  clockStatus:{ fontFamily: FONT, fontSize: 7, color: '#333', letterSpacing: 2, marginTop: 6 },

  // Progress
  progTrack: { width: '100%', height: 10, backgroundColor: '#080810', borderWidth: 1, borderColor: '#0e0e1e', overflow: 'hidden' },
  progFill:  { position: 'absolute', top: 0, left: 0, height: '100%' },
  progTxt:   { fontFamily: FONT, fontSize: 6, color: 'rgba(255,255,255,0.25)', textAlign: 'center', letterSpacing: 1, lineHeight: 10 },

  // Controls
  controls:   { flexDirection: 'row' },
  btnMain:    { paddingHorizontal: 18, paddingVertical: 12, borderWidth: 2, backgroundColor: 'transparent', marginHorizontal: 5 },
  btnMainTxt: { fontFamily: FONT, fontSize: 9, letterSpacing: 2 },
  btnSec:     { paddingHorizontal: 14, paddingVertical: 12, borderWidth: 2, borderColor: '#111', marginHorizontal: 5 },
  btnSecTxt:  { fontFamily: FONT, fontSize: 9, color: '#333', letterSpacing: 2 },

  // Tomatoes
  tomatoes: { flexDirection: 'row' },

  // GIF panel
  gifPanel:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', borderWidth: 1, borderColor: '#0e0e1e', padding: 8, backgroundColor: 'rgba(0,0,0,0.5)' },
  gifPanelLeft:  { flexDirection: 'row', alignItems: 'center', flex: 1 },
  gifPanelRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  gifThumb:      { width: 36, height: 36, marginRight: 8 },
  gifInfo:       { flex: 1 },
  gifInfoName:   { fontFamily: FONT, fontSize: 7, color: '#39ff14', letterSpacing: 1 },
  gifInfoSub:    { fontFamily: FONT, fontSize: 6, color: '#333', letterSpacing: 1, marginTop: 2 },
  gifEmpty:      { fontFamily: FONT, fontSize: 7, color: '#222', letterSpacing: 1 },
  btnGif:        { paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: '#39ff14' },
  btnGifTxt:     { fontFamily: FONT, fontSize: 7, color: '#39ff14', letterSpacing: 1 },
  btnTry:        { paddingHorizontal: 8, paddingVertical: 7, borderWidth: 1, borderColor: '#555' },
  btnTryTxt:     { fontFamily: FONT, fontSize: 7, color: '#555', letterSpacing: 1 },

  // Quote
  quote: { fontFamily: FONT, fontSize: 6, color: '#1a1a1a', letterSpacing: 1, textAlign: 'center', lineHeight: 14 },

  // Break screen
  breakScreen:  { flex: 1, backgroundColor: '#000011' },
  breakGif:     { ...StyleSheet.absoluteFillObject },
  gifFallback:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fbDeco:       { fontFamily: FONT, fontSize: 10, letterSpacing: 1 },
  fbLabel:      { fontFamily: FONT, fontSize: 14, letterSpacing: 4, marginVertical: 12 },
  fbTime:       { fontFamily: FONT, fontSize: 44, letterSpacing: 5 },
  fbHint:       { fontFamily: FONT, fontSize: 7, color: '#222', marginTop: 16 },
  scanOverlay:  { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,17,0.25)' },
  breakHud:     { position: 'absolute', bottom: 80, alignSelf: 'center', alignItems: 'center', paddingHorizontal: 36, paddingVertical: 24, borderWidth: 2, backgroundColor: 'rgba(0,0,17,0.85)' },
  breakLabel:   { fontFamily: FONT, fontSize: 11, letterSpacing: 4, marginBottom: 10 },
  breakTime:    { fontFamily: FONT, fontSize: 44, letterSpacing: 5, color: '#fff', marginBottom: 18 },
  endBtn:       { position: 'absolute', top: 48, right: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  endBtnTxt:    { fontFamily: FONT, fontSize: 9, color: 'rgba(255,255,255,0.35)', letterSpacing: 1 },

  // Warning modal
  warnOverlay:    { flex: 1, backgroundColor: 'rgba(0,0,17,0.95)', alignItems: 'center', justifyContent: 'center' },
  warnBox:        { alignItems: 'center', paddingHorizontal: 28, paddingVertical: 32, borderWidth: 2, borderColor: '#39ff14', backgroundColor: '#000011', width: '85%' },
  warnTitle:      { fontFamily: FONT, fontSize: 10, color: '#39ff14', letterSpacing: 2, textAlign: 'center', marginBottom: 12 },
  warnLbl:        { fontFamily: FONT, fontSize: 7, color: '#666', letterSpacing: 2, marginBottom: 4 },
  warnCount:      { fontFamily: FONT, fontSize: 52, color: '#39ff14', marginBottom: 4 },
  warnSub:        { fontFamily: FONT, fontSize: 6, color: '#444', letterSpacing: 1, marginBottom: 14 },
  breakPickRow:   { flexDirection: 'row', marginBottom: 14 },
  btnBreakPick:   { flex: 1, paddingHorizontal: 12, paddingVertical: 12, borderWidth: 2, alignItems: 'center', marginHorizontal: 5 },
  btnBreakPickTxt:{ fontFamily: FONT, fontSize: 8, letterSpacing: 1 },
  btnSkip:        { paddingHorizontal: 18, paddingVertical: 10, borderWidth: 2, borderColor: '#ff4444' },
  btnSkipTxt:     { fontFamily: FONT, fontSize: 8, color: '#ff4444', letterSpacing: 2 },
})
