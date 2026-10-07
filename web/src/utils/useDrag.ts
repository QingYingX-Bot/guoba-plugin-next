import { onUnmounted, reactive } from 'vue'

export function useDrag() {
  const offset = reactive({ x: 0, y: 0 })

  let start: { px: number; py: number; ox: number; oy: number } | null = null

  function onDown(e: PointerEvent) {
    if (e.button !== 0) return
    start = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    e.preventDefault()
  }

  function onMove(e: PointerEvent) {
    if (!start) return
    offset.x = start.ox + (e.clientX - start.px)
    offset.y = start.oy + (e.clientY - start.py)
  }

  function onUp() {
    start = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
  }

  function reset() {
    offset.x = 0
    offset.y = 0
  }

  onUnmounted(onUp)

  return { offset, onDown, reset }
}
