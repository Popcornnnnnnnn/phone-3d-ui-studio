import { useEffect, useRef, type ReactNode } from 'react'
import { useLocalAssetAvailability } from '../model/useLocalAssetAvailability'
import './workspace.css'

export function WorkspaceInspector({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const localModel = useLocalAssetAvailability()
  const indicator = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  function showIndicator(element: HTMLDivElement) {
    if (!indicator.current) return
    const { clientHeight, scrollHeight, scrollTop } = element
    const height = Math.max(28, clientHeight * clientHeight / scrollHeight)
    indicator.current.style.height = `${height}px`
    indicator.current.style.transform = `translateY(${scrollTop / Math.max(1, scrollHeight - clientHeight) * (clientHeight - height)}px)`
    indicator.current.style.opacity = scrollHeight > clientHeight ? '1' : '0'
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { if (indicator.current) indicator.current.style.opacity = '0' }, 800)
  }
  return <aside className="workspace-inspector" aria-label={`${title} controls`}>
    <div className="workspace-inspector-scroll" onScroll={(event) => showIndicator(event.currentTarget)}>
      <header className="workspace-inspector-heading"><h1>{title}</h1><p>{description}</p></header>
      {localModel === false && <p className="workspace-notice" role="status">Detailed phone model unavailable. Showing the simplified phone.</p>}
      {children}
    </div>
    <div className="workspace-scroll-indicator" ref={indicator} aria-hidden="true" />
  </aside>
}

export function WorkspaceConnection({ description, status, nextStep }: { description: string; status?: string; nextStep?: string }) {
  const desktop = document.documentElement.dataset.desktop === 'true'
  return <section className="workspace-connection">
    <div className="workspace-connection-title"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="7" y="2" width="10" height="20" rx="3" /><path d="M10 5h4M10 19h4M3 8c-1.5 2-1.5 6 0 8M21 8c1.5 2 1.5 6 0 8" strokeLinecap="round" /></svg><h2>Connect your iPhone</h2></div>
    <p>{description}</p>
    {status && <p role="status"><strong>{status}</strong>{nextStep && <> · {nextStep}</>}</p>}
    {desktop && <button className="workspace-primary" onClick={() => window.webkit?.messageHandlers?.studio?.postMessage('connect-phone')}>Connect iPhone</button>}
    <span className="workspace-connection-footnote">Same Wi-Fi · no cable needed</span>
  </section>
}

export function WorkspaceStatus({ children, live = false }: { children: ReactNode; live?: boolean }) {
  return <div className={'workspace-stage-status' + (live ? ' is-live' : '')} role="status"><i aria-hidden="true" />{children}</div>
}
