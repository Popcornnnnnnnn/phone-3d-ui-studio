import {
  DEFAULT_PHONE_FINISH_ID,
  type PhoneFinishId,
  type PhoneProfile,
} from '../../shared/phoneGeometry.mjs'
import { SPATIAL_MODEL_SCALE } from '../../shared/spatialMath.mjs'
import { IPhone17Model } from '../scene/IPhone17Model'
import type { TextureScreenMedia } from '../studio/screenMedia'

/** Physical meters across all iPhone and adaptive Android profiles. */
export function SpatialPhoneModel({
  profile,
  finishId = DEFAULT_PHONE_FINISH_ID,
  media,
}: {
  profile: PhoneProfile
  finishId?: PhoneFinishId
  media: TextureScreenMedia
}) {
  return (
    <group scale={SPATIAL_MODEL_SCALE}>
      <IPhone17Model
        externallyDriven
        animate={false}
        view="front"
        orientation="portrait"
        screenMedia={media}
        profile={profile}
        finishId={finishId}
      />
    </group>
  )
}
