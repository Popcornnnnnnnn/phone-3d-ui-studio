import { useMemo, useState } from 'react'
import { IPHONE_17_MM, type ReviewView } from './model/iphone17'
import { StudioScene } from './scene/StudioScene'
import { findStudioPreset, studioPresets } from './studio/presets'

export function App() {
  const [presetId, setPresetId] = useState(studioPresets[0].id)
  const [animate, setAnimate] = useState(true)
  const [view, setView] = useState<ReviewView>('studio')
  const preset = useMemo(() => findStudioPreset(presetId), [presetId])

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">M1 · iPhone 17 geometry</p>
          <h1>Phone 3D UI Studio</h1>
        </div>
        <div className="status-cluster" aria-label="Source status">
          <span className="status-dot" aria-hidden="true" />
          <span>Local preview</span>
        </div>
      </header>

      <section className="workspace">
        <div className="viewport" aria-label="Interactive 3D phone viewport">
          <StudioScene preset={preset} animate={animate} view={view} />
          <div className="viewport-label">
            <span>Preview 01</span>
            <span>{view === 'studio' ? 'Drag to orbit · Scroll to zoom' : `${view} review`}</span>
          </div>
        </div>

        <aside className="inspector" aria-label="Studio controls">
          <section className="panel-section">
            <p className="section-kicker">Scene</p>
            <h2>Studio preset</h2>
            <div className="preset-grid">
              {studioPresets.map((item) => (
                <button
                  className={item.id === preset.id ? 'preset active' : 'preset'}
                  key={item.id}
                  onClick={() => setPresetId(item.id)}
                  type="button"
                  aria-pressed={item.id === preset.id}
                >
                  <span
                    className="swatch"
                    style={{ background: item.background, color: item.accent }}
                  />
                  <span>{item.name}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel-section">
            <p className="section-kicker">Review camera</p>
            <h2>Model views</h2>
            <div className="view-switcher" role="group" aria-label="Model review view">
              {(['studio', 'front', 'back'] as const).map((item) => (
                <button
                  className={item === view ? 'view-button active' : 'view-button'}
                  key={item}
                  type="button"
                  aria-pressed={item === view}
                  onClick={() => setView(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </section>

          <section className="panel-section source-card">
            <div>
              <p className="section-kicker">Screen source</p>
              <h2>Isolated mesh</h2>
            </div>
            <span className="chip">Idle</span>
            <p>
              1206 × 2622 target. Prerecorded and live sources share the same contract.
            </p>
          </section>

          <section className="panel-section source-card">
            <div>
              <p className="section-kicker">Pose source</p>
              <h2>Simulated motion</h2>
            </div>
            <span className="chip ready">Ready</span>
            <button
              className="wide-button"
              type="button"
              onClick={() => setAnimate((value) => !value)}
            >
              {animate ? 'Pause motion' : 'Resume motion'}
            </button>
          </section>

          <section className="panel-section metrics">
            <p className="section-kicker">Calibrated geometry</p>
            <dl>
              <div>
                <dt>Body</dt>
                <dd>{IPHONE_17_MM.width} × {IPHONE_17_MM.height} mm</dd>
              </div>
              <div>
                <dt>Depth</dt>
                <dd>{IPHONE_17_MM.depth} mm</dd>
              </div>
              <div>
                <dt>Finish</dt>
                <dd>Black</dd>
              </div>
            </dl>
          </section>
        </aside>
      </section>
    </main>
  )
}
