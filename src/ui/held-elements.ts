import { edgeScroll } from './highlight-editor.ts';
export interface ElementDrag {
  move: (x: number, y: number) => void;
  finish: (cancel: boolean) => void;
}
/** A hold selects. Only movement after the hold starts a drag. */
export function attachHeldElements(root: HTMLElement, options: {
  resolve: (target: Element) => HTMLElement | undefined;
  select: (target: HTMLElement) => void;
  startDrag: (target: HTMLElement, x: number, y: number, pointerType:string) => ElementDrag | undefined;
}) {
  let held: {
      node: HTMLElement;
      pointer: number;
      type: string;
      armed: boolean;
      cancelled: boolean;
      x: number;
      y: number;
      startX: number;
      startY: number;
      lastY: number;
      timer: ReturnType<typeof setTimeout>;
      drag?: ElementDrag;
      stop?: () => void;
    } | undefined,
    suppress = false;
  function down(event: PointerEvent) {
    suppress = false;
    if (event.button !== 0) return;
    const node = options.resolve(event.target as Element);
    if (!node || node.closest('.personal-note,.highlight-controls')) return;
    finish(undefined, true);
    held = {
      node,
      pointer: event.pointerId,
      type: event.pointerType,
      armed: false,
      cancelled: false,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      lastY: event.clientY,
      timer: setTimeout(() => {
        if (!held || held.cancelled || !held.node.isConnected) return;
        held.armed = true;
        options.select(held.node);
        getSelection()?.removeAllRanges();
        root.setPointerCapture(held.pointer);
      }, 450)
    };
    if (node.matches('.chord')) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
  function move(event: PointerEvent) {
    if (!held || held.pointer !== event.pointerId) return;
    held.x = event.clientX;
    held.y = event.clientY;
    if (held.armed) {
      event.preventDefault();
      if (!held.drag && Math.hypot(held.x - held.startX, held.y - held.startY) > 4) {
        held.drag = options.startDrag(held.node, held.startX, held.startY,held.type);
        if (held.drag) held.stop = edgeScroll(() => held?.y ?? innerHeight / 2, () => {
          if (held) held.drag?.move(held.x, held.y);
        });
      }
      held.drag?.move(held.x, held.y);
    } else if (Math.hypot(held.x - held.startX, held.y - held.startY) > 8) {
      clearTimeout(held.timer);
      held.cancelled = true;
      if (held.type === 'touch' && held.node.matches('.chord')) {
        event.preventDefault();
        window.scrollBy(0, held.lastY - held.y);
      }
    }
    held.lastY = held.y;
  }
  function finish(event?: PointerEvent, cancel = false) {
    if (!held || event && held.pointer !== event.pointerId) return;
    const current = held;
    held = undefined;
    clearTimeout(current.timer);
    current.stop?.();
    current.drag?.finish(cancel);
    if (root.hasPointerCapture(current.pointer)) root.releasePointerCapture(current.pointer);
    suppress = current.armed || current.cancelled || cancel;
    if (!suppress && current.type === 'touch' && current.node.matches('.chord')) {
      current.node.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        clientX: current.x,
        clientY: current.y
      }));
      suppress = true;
    }
  }
  const click = (event: MouseEvent) => {
    if (suppress) {
      suppress = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') finish(undefined, true);
  };
  const up = (event: PointerEvent) => finish(event),
    cancel = (event: PointerEvent) => finish(event, true);
  root.addEventListener('pointerdown', down, true);
  document.addEventListener('pointermove', move, {
    passive: false
  });
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', cancel);
  root.addEventListener('click', click, true);
  document.addEventListener('keydown', key, true);
  return () => {
    finish(undefined, true);
    root.removeEventListener('pointerdown', down, true);
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', cancel);
    root.removeEventListener('click', click, true);
    document.removeEventListener('keydown', key, true);
  };
}
