import React, { useState, useEffect } from 'react'

export interface SelectedGif {
  path: string
  url: string
  name: string
}

interface SavedEntry {
  path: string
  name: string
}

const STORAGE_KEY = 'ft_local_gifs'

export function toFileUrl(p: string): string {
  const encodedPath = p
    .replace(/\\/g, '/')
    .split('/')
    .map(seg => encodeURIComponent(seg).replace(/%3A/g, ':'))
    .join('/')
  return encodedPath.startsWith('/') ? `file://${encodedPath}` : `file:///${encodedPath}`
}

function loadSaved(): SavedEntry[] {
  try {
    const all: SavedEntry[] = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return all.filter(e => /\.(gif|webp)$/i.test(e.path))
  } catch { return [] }
}

function saveSaved(entries: SavedEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
}

interface Props {
  onSelect: (gif: SelectedGif) => void
  onClose:  () => void
}

export function GifPicker({ onSelect, onClose }: Props) {
  const [library, setLibrary] = useState<SavedEntry[]>(loadSaved)
  const [adding, setAdding]   = useState(false)

  useEffect(() => { saveSaved(library) }, [library])

  async function addGifs() {
    if (!window.api?.pickGifFiles) return
    setAdding(true)
    try {
      const paths = await window.api.pickGifFiles()
      if (!paths.length) return
      setLibrary(prev => {
        const existing = new Set(prev.map(e => e.path))
        const newEntries: SavedEntry[] = paths
          .filter(p => !existing.has(p))
          .map(p => ({ path: p, name: p.split(/[\\/]/).pop() ?? p }))
        return [...prev, ...newEntries]
      })
    } finally {
      setAdding(false)
    }
  }

  function removeEntry(path: string) {
    setLibrary(prev => prev.filter(e => e.path !== path))
  }

  function select(entry: SavedEntry) {
    onSelect({ path: entry.path, url: toFileUrl(entry.path), name: entry.name })
    onClose()
  }

  return (
    <div className="picker-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="picker-box">

        <div className="picker-header">
          <span className="picker-title">◈ LOCAL GIF LIBRARY</span>
          <button className="picker-close" onClick={onClose}>✕</button>
        </div>

        <div className="picker-toolbar">
          <button className="btn-picker" onClick={addGifs} disabled={adding}>
            {adding ? '▓▒░ LOADING...' : '+ ADD GIFS FROM DEVICE'}
          </button>
          {library.length > 0 && (
            <button
              className="btn-picker-alt"
              onClick={() => setLibrary([])}
              title="Remove all from library"
            >
              CLEAR ALL
            </button>
          )}
        </div>

        {library.length === 0 ? (
          <div className="picker-empty">
            <div className="picker-empty-icon">📁</div>
            <div className="picker-empty-text">NO GIFS IN LIBRARY</div>
            <div className="picker-empty-hint">click + ADD GIFS FROM DEVICE to browse your files</div>
          </div>
        ) : (
          <div className="picker-grid">
            {library.map(entry => (
              <div key={entry.path} className="picker-cell-wrap">
                <button className="picker-cell" onClick={() => select(entry)}>
                  <img
                    src={toFileUrl(entry.path)}
                    alt={entry.name}
                    onError={e => { (e.target as HTMLImageElement).style.opacity = '0.2' }}
                  />
                  <div className="picker-cell-label">SELECT</div>
                </button>
                <button
                  className="picker-cell-del"
                  onClick={e => { e.stopPropagation(); removeEntry(entry.path) }}
                  title="Remove from library"
                >
                  ✕
                </button>
                <div className="picker-cell-name">{entry.name.slice(0, 18)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
