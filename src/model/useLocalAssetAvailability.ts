import { useEffect, useState } from 'react'
import { LOCAL_IPHONE_17_ASSET_URL } from '../scene/LocalIPhone17Asset'
import { isLocalModelResponse } from './localAssetAvailability'

let localAssetAvailability: boolean | undefined

export function useLocalAssetAvailability() {
  const [available, setAvailable] = useState<boolean | undefined>(() => localAssetAvailability)

  useEffect(() => {
    if (localAssetAvailability !== undefined) return
    const controller = new AbortController()
    void fetch(LOCAL_IPHONE_17_ASSET_URL, { method: 'HEAD', signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return
        localAssetAvailability = isLocalModelResponse(response)
        setAvailable(localAssetAvailability)
      })
      .catch(() => { if (!controller.signal.aborted) setAvailable(false) })
    return () => controller.abort()
  }, [])

  return available
}
