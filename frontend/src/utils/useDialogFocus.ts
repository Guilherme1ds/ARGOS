import { useEffect, type RefObject } from 'react'

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Foco de diálogo modal: ao abrir, leva o foco para dentro (primeiro controle); Tab e Shift+Tab circulam só
 * dentro do diálogo; ao fechar, devolve o foco ao elemento que o abriu. Escape continua com quem abriu o modal.
 */
export function useDialogFocus(open: boolean, container: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // getClientRects também vale para elementos com position: fixed (offsetParent é null para eles).
    const focusables = () =>
      Array.from(container.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []).filter(
        (element) => element.getClientRects().length > 0 || element === document.activeElement,
      )

    // Depois da pintura: o conteúdo do modal já está no DOM.
    const frame = window.requestAnimationFrame(() => {
      if (!container.current?.contains(document.activeElement)) focusables()[0]?.focus()
    })

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab' || !container.current) return
      const elements = focusables()
      if (!elements.length) return
      const first = elements[0]
      const last = elements[elements.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !container.current.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !container.current.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
      if (opener?.isConnected) opener.focus()
    }
  }, [open, container])
}
