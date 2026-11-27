import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatRoomCode } from '../../shared/webPlayProtocol.mjs'
import { NativeDialog } from './NativeDialog'
import { QrCodeSvg } from './QrCodeSvg'
import type { SharedRoomController } from './useSharedRoom'

export function PairPhoneControl({
  sharedRoom,
  className = '',
}: {
  sharedRoom: SharedRoomController
  className?: string
}) {
  const [qrOpen, setQrOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
    }
  }, [])

  const pairUrl = useMemo(() => {
    if (typeof window === 'undefined') return `https://phone3d.popcornnn.xyz/?pair=${sharedRoom.roomCode}`
    const u = new URL(window.location.href)
    u.search = `?pair=${sharedRoom.roomCode}`
    u.hash = ''
    return u.toString()
  }, [sharedRoom.roomCode])

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(pairUrl)
      setCopied(true)
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* ignore */
    }
  }, [pairUrl])

  return (
    <>
      <button
        type="button"
        className={
          'webplay-glass-pill' +
          (sharedRoom.paired ? ' is-paired' : '') +
          (className ? ` ${className}` : '')
        }
        aria-expanded={qrOpen}
        onClick={() => setQrOpen(true)}
      >
        <span className={'webplay-status-dot' + (sharedRoom.paired ? ' is-paired' : '')} aria-hidden="true" />
        <span>{sharedRoom.paired ? 'Paired' : 'Pair Phone'}</span>
        <code className="webplay-code-chip">{formatRoomCode(sharedRoom.roomCode)}</code>
      </button>

      <NativeDialog open={qrOpen} title="Pair with your phone" onClose={() => setQrOpen(false)}>
        <p>Scan with your iPhone or Android camera to drive the 3D phone live and auto-match your hardware shell.</p>
        <div className="webplay-dialog-qr">
          <QrCodeSvg value={pairUrl} size={200} label="Large QR pairing code" />
          <div className="webplay-room-code">{formatRoomCode(sharedRoom.roomCode)}</div>
        </div>
        <div className="webplay-dialog-actions">
          <button type="button" onClick={() => void handleCopyLink()}>
            {copied ? 'Copied link' : 'Copy URL'}
          </button>
          <button type="button" onClick={sharedRoom.regenerateRoom}>
            New code
          </button>
          <button type="button" autoFocus onClick={() => setQrOpen(false)}>
            Done
          </button>
        </div>
      </NativeDialog>
    </>
  )
}
