import { useState } from 'react'
import {
  PHONE_FINISHES,
  PHONE_PROFILES,
  type PhoneProfileId,
} from '../../shared/phoneGeometry.mjs'
import { ALL_PUBLIC_ATTRIBUTIONS } from '../model/publicPhoneAssets'
import type { PhoneAppearanceState } from '../model/usePhoneAppearance'
import { NativeDialog } from './NativeDialog'

const ORDERED_PROFILES: readonly PhoneProfileId[] = [
  'iphone-17-pro',
  'iphone-17-pro-max',
  'iphone-17',
  'iphone-16-pro',
  'iphone-16-pro-max',
  'iphone-16',
  'iphone-16-plus',
  'android-adaptive',
]

export function DeviceAppearancePicker({
  appearance,
  onUserChange,
  compact = false,
}: {
  appearance: PhoneAppearanceState
  onUserChange?: (profileId: PhoneProfileId) => void
  compact?: boolean
}) {
  const [creditsOpen, setCreditsOpen] = useState(false)

  return (
    <section className={compact ? 'device-picker-card is-compact' : 'workspace-section device-picker-card'} aria-label="Phone model and finish">
      <div className="device-picker-header">
        <h2>Phone Model &amp; Finish</h2>
        {appearance.detectedLabel && (
          <span className="device-detected-pill" title={appearance.detectedLabel}>
            {appearance.autoMatch ? appearance.detectedLabel : 'Manual'}
          </span>
        )}
      </div>

      <label className="workspace-select-row device-model-select">
        <span>Model</span>
        <select
          aria-label="Phone model"
          value={appearance.profileId}
          onChange={(event) => {
            const id = event.target.value as PhoneProfileId
            appearance.setProfileId(id)
            onUserChange?.(id)
          }}
        >
          {ORDERED_PROFILES.map((id) => {
            const label =
              id === 'android-adaptive' && appearance.detectedDevice?.modelHint
                ? `Android (${appearance.detectedDevice.modelHint})`
                : PHONE_PROFILES[id].name
            return (
              <option key={id} value={id}>
                {label}
              </option>
            )
          })}
        </select>
      </label>

      <div className="device-finish-row" role="group" aria-label="Chassis finish">
        {PHONE_FINISHES.map((finish) => {
          const active = appearance.finishId === finish.id
          return (
            <button
              key={finish.id}
              type="button"
              className={'device-swatch' + (active ? ' is-active' : '')}
              aria-pressed={active}
              aria-label={finish.label}
              title={finish.label}
              style={{ backgroundColor: finish.swatch }}
              onClick={() => appearance.setFinishId(finish.id)}
            />
          )
        })}
        <span className="device-finish-name">{appearance.finish.label}</span>
      </div>

      <div className="device-picker-foot">
        {appearance.detectedDevice && !appearance.autoMatch ? (
          <button
            type="button"
            className="device-link-btn"
            onClick={() => appearance.resetToDetected()}
          >
            Auto-match phone
          </button>
        ) : (
          <span className="device-dim-label">
            {appearance.profile.bodyMm.width} × {appearance.profile.bodyMm.height} mm
          </span>
        )}
        <button
          type="button"
          className="device-link-btn"
          onClick={() => setCreditsOpen(true)}
        >
          3D Credits (CC-BY 4.0)
        </button>
      </div>

      <NativeDialog
        open={creditsOpen}
        title="3D Model Credits (CC-BY 4.0)"
        onClose={() => setCreditsOpen(false)}
      >
        <p>
          Interactive iPhone hardware models are adapted from open-source Sketchfab assets under Creative Commons Attribution 4.0.
        </p>
        <ul className="device-credits-list">
          {ALL_PUBLIC_ATTRIBUTIONS.map((item) => (
            <li key={item.id}>
              <strong>
                <a href={item.modelUrl} target="_blank" rel="noreferrer">
                  {item.title}
                </a>
              </strong>{' '}
              by{' '}
              <a href={item.creatorUrl} target="_blank" rel="noreferrer">
                {item.creator}
              </a>{' '}
              (
              <a href={item.licenseUrl} target="_blank" rel="noreferrer">
                {item.licenseName}
              </a>
              )
              <span className="device-credit-mod">{item.modifications}</span>
            </li>
          ))}
        </ul>
        <p className="device-credit-disclaimer">
          The Android Adaptive model is an original parametric mesh. iPhone is a trademark of Apple Inc.; this project is not affiliated with or endorsed by Apple Inc.
        </p>
        <div className="webplay-dialog-actions">
          <button type="button" autoFocus onClick={() => setCreditsOpen(false)}>
            Close
          </button>
        </div>
      </NativeDialog>
    </section>
  )
}
