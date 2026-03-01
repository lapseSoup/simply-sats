import { useRef, useCallback, useState } from 'react';

/**
 * Hook for swipe-to-dismiss gesture on mobile bottom sheets.
 *
 * Tracks touch events on a target element, applies a CSS translateY transform
 * during the swipe, and calls `onDismiss` when the swipe crosses the distance
 * threshold (150 px) or velocity threshold (0.5 px/ms). Springs back to the
 * resting position if neither threshold is met.
 *
 * @param onDismiss - Callback invoked when the sheet should be dismissed.
 * @param enabled   - When false, no gesture listeners are attached. Default: true.
 *
 * @returns
 *   - `ref`   – Attach to the swipeable element via the `ref` prop.
 *   - `style` – Spread onto the same element to apply the live transform.
 *
 * @example
 * ```tsx
 * const { ref, style } = useSwipeDismiss({ onDismiss: closeSheet });
 * return <div ref={ref} style={style}>…</div>;
 * ```
 */

const DISMISS_DISTANCE_PX = 150;
const DISMISS_VELOCITY_PX_MS = 0.5;
const TRANSITION_SPRING = 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)';

interface UseSwipeDismissOptions {
  onDismiss: () => void;
  enabled?: boolean;
}

interface UseSwipeDismissResult {
  ref: React.RefCallback<HTMLElement>;
  style: React.CSSProperties;
}

export function useSwipeDismiss({
  onDismiss,
  enabled = true,
}: UseSwipeDismissOptions): UseSwipeDismissResult {
  const elementRef = useRef<HTMLElement | null>(null);
  const startYRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const currentDeltaRef = useRef<number>(0);
  const isDraggingRef = useRef<boolean>(false);

  const [style, setStyle] = useState<React.CSSProperties>({});

  const applyTransform = useCallback((deltaY: number, animate: boolean) => {
    setStyle({
      transform: `translateY(${Math.max(0, deltaY)}px)`,
      transition: animate ? TRANSITION_SPRING : 'none',
      willChange: animate ? 'auto' : 'transform',
    });
  }, []);

  const resetTransform = useCallback(() => {
    setStyle({
      transform: 'translateY(0)',
      transition: TRANSITION_SPRING,
      willChange: 'auto',
    });
  }, []);

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (!enabled) return;
      const touch = e.touches[0]!;
      startYRef.current = touch.clientY;
      startTimeRef.current = Date.now();
      currentDeltaRef.current = 0;
      isDraggingRef.current = true;
    },
    [enabled],
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!enabled || !isDraggingRef.current) return;
      const touch = e.touches[0]!;
      const delta = touch.clientY - startYRef.current;
      currentDeltaRef.current = delta;

      // Only translate downward; resist upward over-scroll.
      if (delta > 0) {
        applyTransform(delta, false);
      }
    },
    [enabled, applyTransform],
  );

  const handleTouchEnd = useCallback(() => {
    if (!enabled || !isDraggingRef.current) return;
    isDraggingRef.current = false;

    const delta = currentDeltaRef.current;
    const elapsed = Date.now() - startTimeRef.current;
    const velocity = elapsed > 0 ? delta / elapsed : 0;

    const shouldDismiss =
      delta > DISMISS_DISTANCE_PX || velocity > DISMISS_VELOCITY_PX_MS;

    if (shouldDismiss) {
      // Slide fully off-screen before calling onDismiss so the animation
      // completes visually before the sheet is removed from the DOM.
      const offscreen =
        elementRef.current?.getBoundingClientRect().height ?? window.innerHeight;
      applyTransform(offscreen, true);
      const timeout = setTimeout(() => {
        onDismiss();
        // Reset so the element is ready if it remains in the DOM.
        setStyle({});
      }, 300);
      // Cleanup timeout on hot-reload / unmount is handled by the detach path.
      return () => clearTimeout(timeout);
    } else {
      resetTransform();
    }
  }, [enabled, onDismiss, applyTransform, resetTransform]);

  /**
   * Ref callback that attaches/detaches touch listeners whenever the element
   * mounts, unmounts, or `enabled` changes.
   */
  const ref = useCallback(
    (node: HTMLElement | null) => {
      if (elementRef.current) {
        elementRef.current.removeEventListener('touchstart', handleTouchStart);
        elementRef.current.removeEventListener('touchmove', handleTouchMove);
        elementRef.current.removeEventListener('touchend', handleTouchEnd);
      }

      elementRef.current = node;

      if (node && enabled) {
        node.addEventListener('touchstart', handleTouchStart, { passive: true });
        node.addEventListener('touchmove', handleTouchMove, { passive: true });
        node.addEventListener('touchend', handleTouchEnd, { passive: true });
      }
    },
    [enabled, handleTouchStart, handleTouchMove, handleTouchEnd],
  );

  return { ref, style };
}
