import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScreenMedia } from './screenMedia'

export type LocalVideoStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'error'

interface ActiveVideo {
  element: HTMLVideoElement
  objectUrl: string
}

function releaseVideo(activeVideo: ActiveVideo | null) {
  if (!activeVideo) return

  activeVideo.element.pause()
  activeVideo.element.removeAttribute('src')
  activeVideo.element.load()
  URL.revokeObjectURL(activeVideo.objectUrl)
}

function seekVideoToStart(element: HTMLVideoElement) {
  element.currentTime = 0
}

export function useLocalVideoSource() {
  const activeVideo = useRef<ActiveVideo | null>(null)
  const [media, setMedia] = useState<ScreenMedia | null>(null)
  const [status, setStatus] = useState<LocalVideoStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const clear = useCallback(() => {
    releaseVideo(activeVideo.current)
    activeVideo.current = null
    setMedia(null)
    setStatus('idle')
    setError(null)
  }, [])

  const selectFile = useCallback((file: File) => {
    releaseVideo(activeVideo.current)
    setMedia(null)
    setError(null)

    if (!file.type.startsWith('video/')) {
      activeVideo.current = null
      setStatus('error')
      setError('Choose a local video file.')
      return
    }

    const objectUrl = URL.createObjectURL(file)
    const element = document.createElement('video')
    const nextVideo = { element, objectUrl }
    activeVideo.current = nextVideo
    setStatus('loading')

    element.loop = true
    element.muted = true
    element.playsInline = true
    element.preload = 'metadata'

    element.addEventListener('loadedmetadata', () => {
      if (activeVideo.current !== nextVideo) return

      if (element.videoWidth <= 0 || element.videoHeight <= 0) {
        setStatus('error')
        setError('The selected video has no readable dimensions.')
        return
      }

      setMedia({
        element,
        name: file.name,
        width: element.videoWidth,
        height: element.videoHeight,
      })
      setStatus('ready')
    })

    element.addEventListener('play', () => {
      if (activeVideo.current === nextVideo) setStatus('playing')
    })
    element.addEventListener('pause', () => {
      if (activeVideo.current === nextVideo && element.currentTime > 0) {
        setStatus('paused')
      }
    })
    element.addEventListener('error', () => {
      if (activeVideo.current !== nextVideo) return
      setStatus('error')
      setError('This browser could not decode the selected video.')
    })

    element.src = objectUrl
    element.load()
  }, [])

  const play = useCallback(async () => {
    const element = activeVideo.current?.element
    if (!element || !media) return

    try {
      await element.play()
    } catch {
      setStatus('error')
      setError('Playback was blocked. Select the video again or retry Play.')
    }
  }, [media])

  const pause = useCallback(() => {
    activeVideo.current?.element.pause()
  }, [])

  const reset = useCallback(() => {
    const element = activeVideo.current?.element
    if (!element) return

    element.pause()
    seekVideoToStart(element)
    setStatus('ready')
  }, [])

  useEffect(() => clear, [clear])

  return { clear, error, media, pause, play, reset, selectFile, status }
}
