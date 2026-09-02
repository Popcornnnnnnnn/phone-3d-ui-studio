import { useMemo, useState } from 'react'
import { StudioScene } from './scene/StudioScene'
import { findStudioPreset, studioPresets } from './studio/presets'

export function App() {
  const [presetId, setPresetId] = useState(studioPresets[0].id)
  const [animate, setAnimate] = useState(true)
  const preset = useMemo(() => findStudioPreset(presetId), [presetId])

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">M0 · Renderer foundation</p>
          <h1>Phone 3D UI Studio</h1>
        </div>
        <div className="status-cluster" aria-label="Source status">
          <span className="status-dot" aria-hidden="true" />
          <span>Local preview</span>
        </div>
      </header>

      <section className="workspace">
        <div className="viewport" aria-label="Interactive 3D phone viewport">
          <StudioScene preset={preset} animate={animate} />
          <div className="viewport-label">
            <span>Preview 01</span>
            <span>Drag to orbit · Scroll to zoom</span>
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

          <section className="panel-section source-card">
            <div>
              <p className="section-kicker">Screen source</p>
              <h2>Placeholder</h2>
            </div>
            <span className="chip">Idle</span>
            <p>
              Prerecorded media and live capture will implement the same screen-source
              contract.
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
            <p className="section-kicker">Render budget</p>
            <dl>
              <div>
                <dt>Target</dt>
                <dd>60 fps</dd>
              </div>
              <div>
                <dt>Viewport</dt>
                <dd>Adaptive</dd>
              </div>
              <div>
                <dt>Sources</dt>
                <dd>Decoupled</dd>
              </div>
            </dl>
          </section>
        </aside>
      </section>
    </main>
  )
}
