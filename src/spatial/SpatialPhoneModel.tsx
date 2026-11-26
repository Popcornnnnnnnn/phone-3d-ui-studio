import { useEffect, useMemo } from 'react'
import { ExtrudeGeometry } from 'three'
import type { PhoneProfile } from '../../shared/phoneGeometry.mjs'
import { SPATIAL_MODEL_SCALE } from '../../shared/spatialMath.mjs'
import { marbleGeometry } from '../../shared/marbleMath.mjs'
import { DEFAULT_MARBLE_SETTINGS } from '../../shared/marbleSettings.mjs'
import { createRoundedRectangleGeometry, createRoundedRectangleShape } from '../model/roundedRectangle'
import { IPhone17Model } from '../scene/IPhone17Model'
import type { TextureScreenMedia } from '../studio/screenMedia'

function ApproximatePhone({ profile, media }: { profile: PhoneProfile; media: TextureScreenMedia }) {
  const geometry = useMemo(() => {
    const width = profile.bodyMm.width / 1000, height = profile.bodyMm.height / 1000, depth = profile.bodyMm.depth / 1000
    const g = marbleGeometry(DEFAULT_MARBLE_SETTINGS, profile)
    const body = new ExtrudeGeometry(createRoundedRectangleShape(width, height, 0.01), { depth, bevelEnabled: false, curveSegments: 20, steps: 1 })
    body.translate(0, 0, -depth / 2)
    return { body, screen: createRoundedRectangleGeometry(g.width, g.height, g.cornerRadius), screenZ: g.screenZ }
  }, [profile])
  useEffect(() => () => { geometry.body.dispose(); geometry.screen.dispose() }, [geometry])
  return <group name="approximate-profile-phone">
    <mesh geometry={geometry.body}><meshStandardMaterial color="#25302e" metalness={0.55} roughness={0.35} /></mesh>
    <mesh name="screen-mesh" geometry={geometry.screen} position={[0, 0, geometry.screenZ]}>
      <meshBasicMaterial map={media.texture} toneMapped={false} />
    </mesh>
  </group>
}

/** Physical meters. New profiles use an original, intentionally simplified shell. */
export function SpatialPhoneModel({ profile, media }: { profile: PhoneProfile; media: TextureScreenMedia }) {
  return profile.id === 'iphone-17'
    ? <group scale={SPATIAL_MODEL_SCALE}><IPhone17Model externallyDriven animate={false} view="front" orientation="portrait" screenMedia={media} /></group>
    : <ApproximatePhone profile={profile} media={media} />
}
