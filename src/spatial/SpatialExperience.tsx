import { useState } from 'react'
import { SpatialWorkspace } from './SpatialWorkspace'
import { MarbleWorkspace } from '../marble/MarbleWorkspace'
import '../marble/marble.css'
export function SpatialExperience() {
  const [experience, setExperience] = useState(() => new URLSearchParams(location.search).get('experience') === 'marble' ? 'marble' : 'tracking')
  return <><nav className="spatial-experience-nav" aria-label="Spatial experience">
    {(['tracking', 'marble'] as const).map((value) => <button key={value} aria-pressed={experience === value} onClick={() => {
      setExperience(value); const url = new URL(location.href); url.searchParams.set('experience', value); history.replaceState(null, '', url)
    }}>{value === 'tracking' ? 'Tracking' : 'Marble'}</button>)}
  </nav>{experience === 'marble' ? <MarbleWorkspace /> : <SpatialWorkspace />}</>
}
