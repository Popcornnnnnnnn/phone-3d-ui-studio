export type PosePresentationMode =
  | 'synchronized'
  | 'low-latency'
  | 'instant'
  | 'ultra'

export const POSE_SMOOTHING_RATE: Record<PosePresentationMode, number> = {
  synchronized: 20,
  'low-latency': 60,
  instant: Number.POSITIVE_INFINITY,
  ultra: Number.POSITIVE_INFINITY,
}

export function usesVideoAlignedPose(mode: PosePresentationMode) {
  return mode === 'synchronized'
}

export function usesPosePrediction(mode: PosePresentationMode) {
  return mode === 'ultra'
}
