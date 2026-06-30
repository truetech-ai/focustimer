import React from 'react'
import { DayStat, Durations, loadHistory } from '../App'

interface Props {
  onClose: () => void
  durations: Durations
  onDurationsChange: (d: Durations) => void
}

function calcStreak(history: DayStat[]): number {
  if (!history.length) return 0
  const sorted = [...history].sort((a, b) => b.date.localeCompare(a.date))
  let streak = 0
  let expected = new Date()
  for (const entry of sorted) {
    const d = new Date(entry.date + 'T00:00:00')
    const diff = Math.round((expected.setHours(0,0,0,0) - d.setHours(0,0,0,0)) / 86400000)
    if (diff > 1) break
    if (entry.sessions > 0) { streak++; expected = d }
  }
  return streak
}

function last7(history: DayStat[]): DayStat[] {
  const days: DayStat[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().slice(0, 10)
    const found = history.find(h => h.date === dateStr)
    days.push(found ?? { date: dateStr, sessions: 0, focusMin: 0 })
  }
  return days
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const blocks = max > 0 ? Math.round((value / max) * 10) : 0
  return (
    <span style={{ color, textShadow: `0 0 6px ${color}` }}>
      {'█'.repeat(blocks)}{'░'.repeat(10 - blocks)}
    </span>
  )
}

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)) }

export function StatsModal({ onClose, durations, onDurationsChange }: Props) {
  const history    = loadHistory()
  const week       = last7(history)
  const maxSess    = Math.max(...week.map(d => d.sessions), 1)
  const totalSess  = history.reduce((s, d) => s + d.sessions, 0)
  const totalHours = Math.round(history.reduce((s, d) => s + d.focusMin, 0) / 60 * 10) / 10
  const bestDay    = history.reduce((b, d) => d.sessions > b.sessions ? d : b, { date: '—', sessions: 0, focusMin: 0 })
  const streak     = calcStreak(history)
  const DAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

  function handleDuration(key: keyof Durations, raw: string) {
    const n = parseInt(raw, 10)
    if (isNaN(n)) return
    const mins = { work: [1, 90], shortBreak: [1, 30], longBreak: [5, 60] }[key] as [number, number]
    onDurationsChange({ ...durations, [key]: clamp(n, mins[0], mins[1]) })
  }

  return (
    <div className="picker-bg" onClick={onClose}>
      <div className="picker-box stats-box" onClick={e => e.stopPropagation()}>

        <div className="picker-header">
          <span className="picker-title">◈ STATS</span>
          <button className="picker-close" onClick={onClose}>✕ CLOSE</button>
        </div>

        <div className="stats-body">

          <div className="stats-summary">
            <div className="stats-card">
              <div className="stats-card-val">{totalSess}</div>
              <div className="stats-card-lbl">ALL-TIME SESSIONS</div>
            </div>
            <div className="stats-card">
              <div className="stats-card-val">{totalHours}h</div>
              <div className="stats-card-lbl">TOTAL FOCUSED</div>
            </div>
            <div className="stats-card">
              <div className="stats-card-val" style={{ color: '#ff1493', textShadow: '0 0 10px #ff1493' }}>
                {streak}🔥
              </div>
              <div className="stats-card-lbl">DAY STREAK</div>
            </div>
            <div className="stats-card">
              <div className="stats-card-val">{bestDay.sessions}</div>
              <div className="stats-card-lbl">BEST DAY</div>
            </div>
          </div>

          <div className="stats-chart-title">◈ LAST 7 DAYS</div>
          <div className="stats-chart">
            {week.map((d, i) => {
              const label   = DAY_LABELS[new Date(d.date + 'T00:00:00').getDay()]
              const isToday = i === 6
              return (
                <div key={d.date} className="stats-bar-row">
                  <span className="stats-bar-day" style={{ color: isToday ? '#ffd700' : '#333' }}>
                    {label}
                  </span>
                  <Bar value={d.sessions} max={maxSess} color={isToday ? '#ffd700' : '#39ff14'} />
                  <span className="stats-bar-num" style={{ color: isToday ? '#ffd700' : '#39ff14' }}>
                    {d.sessions}
                  </span>
                </div>
              )
            })}
          </div>

          {bestDay.sessions > 0 && (
            <div className="stats-best">
              BEST: {bestDay.date} — {bestDay.sessions} sessions / {bestDay.focusMin} min
            </div>
          )}

          <div className="stats-chart-title" style={{ marginTop: 16 }}>◈ TIMER SETTINGS</div>
          <div className="stats-timer-settings">
            {(
              [
                { key: 'work',       label: 'FOCUS',       color: '#39ff14', min: 1, max: 90 },
                { key: 'shortBreak', label: 'SHORT BREAK', color: '#ff1493', min: 1, max: 30 },
                { key: 'longBreak',  label: 'LONG BREAK',  color: '#00ffff', min: 5, max: 60 },
              ] as const
            ).map(({ key, label, color, min, max }) => (
              <div key={key} className="stats-timer-row">
                <span className="stats-timer-lbl" style={{ color }}>{label}</span>
                <div className="stats-timer-ctrl">
                  <button
                    className="stats-timer-btn"
                    style={{ borderColor: color, color }}
                    onClick={() => handleDuration(key, String(durations[key] - 1))}
                    disabled={durations[key] <= min}
                  >−</button>
                  <input
                    className="stats-timer-input"
                    style={{ color, borderColor: color }}
                    type="number"
                    min={min}
                    max={max}
                    value={durations[key]}
                    onChange={e => handleDuration(key, e.target.value)}
                  />
                  <span className="stats-timer-unit" style={{ color }}>MIN</span>
                  <button
                    className="stats-timer-btn"
                    style={{ borderColor: color, color }}
                    onClick={() => handleDuration(key, String(durations[key] + 1))}
                    disabled={durations[key] >= max}
                  >+</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
