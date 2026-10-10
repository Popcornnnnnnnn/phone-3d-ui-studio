import { SpatialWorkspace } from './SpatialWorkspace'
import { MarbleWorkspace } from '../marble/MarbleWorkspace'
import '../marble/marble.css'
export function SpatialExperience({ experience, onExperienceChange, showNavigation }: {
  experience: 'tracking' | 'marble'
  onExperienceChange: (experience: 'tracking' | 'marble') => void
  showNavigation: boolean
}) {
  return <div className="spatial-experience">{showNavigation && <nav className="spatial-experience-nav" aria-label="Spatial experience">
    {(['marble', 'tracking'] as const).map((value) => <button key={value} aria-pressed={experience === value} onClick={() => onExperienceChange(value)}>{value === 'tracking' ? 'Tracking' : 'Marble'}</button>)}
  </nav>}{experience === 'marble' ? <MarbleWorkspace /> : <SpatialWorkspace />}</div>
}
