import { useMemo } from 'react'
import QRCode from 'qrcode'

interface QrCodeSvgProps {
  value: string
  size?: number
  label?: string
}

export function QrCodeSvg({ value, size = 148, label = 'QR pairing code' }: QrCodeSvgProps) {
  const { modulesSize, pathData } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' })
    const count = qr.modules.size
    const parts: string[] = []
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.modules.get(row, col)) {
          parts.push(`M${col},${row}h1v1h-1z`)
        }
      }
    }
    return { modulesSize: count, pathData: parts.join('') }
  }, [value])

  const margin = 2
  const viewSize = modulesSize + margin * 2

  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-margin} ${-margin} ${viewSize} ${viewSize}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      style={{ display: 'block', background: '#ffffff', borderRadius: 8 }}
    >
      <rect x={-margin} y={-margin} width={viewSize} height={viewSize} fill="#ffffff" />
      <path d={pathData} fill="#111827" />
    </svg>
  )
}
