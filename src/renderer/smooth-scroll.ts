function getTarget(href: string) {
  if (!href.startsWith('#')) return null
  const id = decodeURIComponent(href.slice(1))
  return id ? document.getElementById(id) : null
}

type ScrollState = {
  target: number
  frame: number | null
}

const scrollStates = new WeakMap<HTMLElement, ScrollState>()

function getScrollableParent(element: Element | null, deltaY: number) {
  let current = element
  while (current && current !== document.body) {
    if (current instanceof HTMLElement) {
      const style = getComputedStyle(current)
      const canScroll = style.overflowY === 'auto' || style.overflowY === 'scroll'
      const hasRoom = deltaY > 0
        ? current.scrollTop < current.scrollHeight - current.clientHeight
        : current.scrollTop > 0
      if (canScroll && hasRoom) return current
    }
    current = current.parentElement
  }
  return null
}

function animateScroll(element: HTMLElement, deltaY: number) {
  const state = scrollStates.get(element) || { target: element.scrollTop, frame: null, writing: false }
  state.target = Math.max(0, Math.min(
    element.scrollHeight - element.clientHeight,
    state.target + deltaY
  ))
  scrollStates.set(element, state)

  if (state.frame !== null) return

  const step = () => {
    const distance = state.target - element.scrollTop
    if (Math.abs(distance) < 0.5) {
      element.scrollTop = state.target
      state.frame = null
      return
    }
    element.scrollTop += distance * 0.18
    state.frame = requestAnimationFrame(step)
  }

  state.frame = requestAnimationFrame(step)
}

export function initSmoothScroll() {
  const onClick = (event: MouseEvent) => {
    const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href^="#"]')
    if (!link) return

    const target = getTarget(link.getAttribute('href') || '')
    if (!target) return

    event.preventDefault()
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    history.replaceState(null, '', link.hash)
  }

  const onWheel = (event: WheelEvent) => {
    if (event.deltaY === 0) return
    const scroller = getScrollableParent(event.target instanceof Element ? event.target : null, event.deltaY)
    if (!scroller) return

    event.preventDefault()
    animateScroll(scroller, event.deltaY)
  }

  const onPointerDown = (event: PointerEvent) => {
    let current = event.target instanceof Element ? event.target : null
    while (current && current !== document.body) {
      if (current instanceof HTMLElement) {
        const style = getComputedStyle(current)
        const canScroll = style.overflowY === 'auto' || style.overflowY === 'scroll'
        if (canScroll && current.scrollHeight > current.clientHeight) {
          const state = scrollStates.get(current)
          if (state) {
            if (state.frame !== null) {
            cancelAnimationFrame(state.frame)
            state.frame = null
            }
            state.target = current.scrollTop
          }
          return
        }
      }
      current = current.parentElement
    }
  }

  document.addEventListener('click', onClick)
  document.addEventListener('wheel', onWheel, { passive: false })
  document.addEventListener('pointerdown', onPointerDown)
  return () => {
    document.removeEventListener('click', onClick)
    document.removeEventListener('wheel', onWheel)
    document.removeEventListener('pointerdown', onPointerDown)
  }
}
