import { useEffect, useId, useRef, type ReactNode } from 'react'

interface NativeDialogProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}

export function NativeDialog({ open, title, onClose, children }: NativeDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return

    const handleClose = () => {
      dialog.returnValue = ''
      onClose()
    }
    dialog.addEventListener('close', handleClose)

    let cleanupBackdrop: (() => void) | undefined
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      const outside = (e: PointerEvent, el: HTMLDialogElement) => {
        const r = el.getBoundingClientRect()
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom
      }
      let pressedOutside = false
      const onDown = (e: PointerEvent) => {
        pressedOutside = outside(e, dialog)
      }
      const onUp = (e: PointerEvent) => {
        if (pressedOutside && outside(e, dialog)) dialog.close()
      }
      dialog.addEventListener('pointerdown', onDown)
      dialog.addEventListener('pointerup', onUp)
      cleanupBackdrop = () => {
        dialog.removeEventListener('pointerdown', onDown)
        dialog.removeEventListener('pointerup', onUp)
      }
    }

    return () => {
      dialog.removeEventListener('close', handleClose)
      cleanupBackdrop?.()
    }
  }, [onClose])

  return (
    <dialog
      ref={ref}
      className="webplay-dialog"
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as Record<string, unknown>)}
    >
      <h1 id={titleId}>{title}</h1>
      {children}
    </dialog>
  )
}
