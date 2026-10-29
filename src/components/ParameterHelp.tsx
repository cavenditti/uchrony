import { useId, useLayoutEffect, useRef, useState } from 'react'
import { CircleHelp } from 'lucide-react'

export function ParameterLabel({
  htmlFor,
  label,
  children,
}: {
  htmlFor: string
  label: string
  children: string
}) {
  return (
    <span className="configuration-field-heading">
      <label htmlFor={htmlFor}>{label}</label>
      <ParameterHelp id={`${htmlFor}-help`} label={label}>
        {children}
      </ParameterHelp>
    </span>
  )
}

/** One explanation works for pointer hover, keyboard focus and touch. Keep the
 * bubble in the viewport, including inside the horizontally scrolling matrix. */
export function ParameterHelp({ label, children, id }: { label: string; children: string; id?: string }) {
  const generatedId = useId()
  const helpId = id ?? generatedId
  const button = useRef<HTMLButtonElement>(null)
  const tooltip = useRef<HTMLSpanElement>(null)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pinned = useRef(false)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  useLayoutEffect(() => {
    if (!open || !button.current || !tooltip.current) return
    const anchor = button.current.getBoundingClientRect()
    const bounds = tooltip.current.getBoundingClientRect()
    setPosition({
      left: Math.max(16, Math.min(anchor.left, window.innerWidth - bounds.width - 16)),
      top:
        anchor.bottom + bounds.height + 12 <= window.innerHeight
          ? anchor.bottom + 8
          : Math.max(16, anchor.top - bounds.height - 8),
    })
    const close = () => {
      pinned.current = false
      setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close()
    }
    window.addEventListener('resize', close)
    document.addEventListener('scroll', close, true)
    document.addEventListener('keydown', escape, true)
    return () => {
      clearTimeout(leaveTimer.current)
      window.removeEventListener('resize', close)
      document.removeEventListener('scroll', close, true)
      document.removeEventListener('keydown', escape, true)
    }
  }, [open])
  return (
    <span
      className="parameter-help"
      onPointerEnter={(event) => {
        clearTimeout(leaveTimer.current)
        if (event.pointerType === 'mouse') setOpen(true)
      }}
      onPointerLeave={() => {
        // Allow the pointer to cross the small gap into the explanation itself.
        leaveTimer.current = setTimeout(() => {
          if (!pinned.current && document.activeElement !== button.current) setOpen(false)
        }, 150)
      }}
    >
      <button
        ref={button}
        type="button"
        className="parameter-help-button"
        aria-label={`About ${label.toLowerCase()}`}
        aria-describedby={helpId}
        aria-expanded={open}
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible')) setOpen(true)
        }}
        onBlur={() => {
          pinned.current = false
          setOpen(false)
        }}
        onClick={() => {
          // Hover may already have opened the bubble before a mouse click.
          // Pin that first click; a second click dismisses it, as on touch.
          pinned.current = !pinned.current
          setOpen(pinned.current)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            setOpen(false)
          }
        }}
      >
        <CircleHelp size={15} aria-hidden="true" />
      </button>
      <span
        ref={tooltip}
        id={helpId}
        role="tooltip"
        className="parameter-help-tooltip"
        hidden={!open}
        style={position}
      >
        {children}
      </span>
    </span>
  )
}
