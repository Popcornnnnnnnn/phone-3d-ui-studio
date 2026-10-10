import { useEffect, useRef, useState, type ReactNode } from 'react'

interface Props {
  label: string
  children: ReactNode
  onReset: () => void
  controls: ReactNode
}

/** Expands the existing canvas in place, preserving its camera and live connection. */
export function SpatialViewport({ label, children, onReset, controls }: Props) {
  const desktop = document.documentElement.dataset.desktop === 'true'
  const element = useRef<HTMLElement>(null)
  const nativeFullscreen = useRef(false)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    const change = () => {
      if (document.fullscreenElement === element.current) {
        nativeFullscreen.current = true; setExpanded(true)
      } else if (nativeFullscreen.current) {
        nativeFullscreen.current = false; setExpanded(false)
      }
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (document.fullscreenElement === element.current) {
        void document.exitFullscreen().catch(() => {})
      } else if (!document.fullscreenElement) setExpanded(false)
    }
    document.addEventListener('fullscreenchange', change)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('fullscreenchange', change)
      document.removeEventListener('keydown', escape)
    }
  }, [])
  useEffect(() => {
    if (!expanded) return
    const overflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    return () => { document.documentElement.style.overflow = overflow }
  }, [expanded])
  async function toggleFullscreen() {
    if (expanded) {
      if (document.fullscreenElement === element.current) {
        try { await document.exitFullscreen() } catch { return }
      }
      setExpanded(false)
    } else {
      setExpanded(true)
      // WKWebView's separate fullscreen window emits a temporary hidden event
      // on exit, which correctly pauses a live world. Expand in the existing
      // Mac window instead so presentation does not interrupt play.
      if (!desktop && document.fullscreenEnabled && element.current?.requestFullscreen) {
        try { await element.current.requestFullscreen() } catch { /* Full-window fallback. */ }
      }
    }
  }
  return <section ref={element} className={'spatial-viewport' + (expanded ? ' is-expanded' : '')} aria-label={label}>
    {children}
    <div className="spatial-viewport-toolbar">
      <span className="spatial-navigation-hint">Drag to orbit · scroll to zoom</span>
      <button onClick={onReset}>Reset view</button>
      <button aria-pressed={expanded} onClick={() => void toggleFullscreen()} title={expanded ? 'Exit full screen (Esc)' : 'Expand the 3D workspace'}>
        {desktop ? expanded ? 'Restore view' : 'Expand view' : expanded ? 'Exit full screen' : 'Full screen'}
      </button>
    </div>
    {expanded && controls && <div className="spatial-fullscreen-controls" aria-label="Fullscreen controls">{controls}<span className="spatial-fullscreen-exit-hint">Esc to exit</span></div>}
  </section>
}
