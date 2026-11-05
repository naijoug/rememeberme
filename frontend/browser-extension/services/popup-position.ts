import type { Position } from '~/types';
export interface Viewport { left: number; top: number; width: number; height: number }
export interface CoordinateSpace { left: number; top: number; scaleX: number; scaleY: number }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));
export function visibleViewport(): Viewport {
  const viewport = window.visualViewport;
  return { left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0,
    width: viewport?.width || window.innerWidth, height: viewport?.height || window.innerHeight };
}
export function coordinateSpace(probe?: HTMLElement): CoordinateSpace {
  const rect = probe?.getBoundingClientRect();
  if (!probe?.offsetWidth || !probe.offsetHeight || !rect?.width || !rect.height) return { left: 0, top: 0, scaleX: 1, scaleY: 1 };
  return { left: rect.left, top: rect.top, scaleX: rect.width / probe.offsetWidth, scaleY: rect.height / probe.offsetHeight };
}
export function positionPopup(anchor: Position, size: { width: number; height: number }, viewport: Viewport,
  space: CoordinateSpace, previous?: { left: number; top: number }) {
  const margin = 12;
  const right = viewport.left + viewport.width, bottom = viewport.top + viewport.height;
  const width = Math.min(size.width, Math.max(0, viewport.width - margin * 2));
  const height = Math.min(size.height, Math.max(0, viewport.height - margin * 2));
  let left = previous ? space.left + previous.left * space.scaleX : anchor.x - width / 2;
  let top = previous ? space.top + previous.top * space.scaleY : anchor.y;
  if (!previous && top + height > bottom - margin) top = (anchor.anchorTop ?? anchor.y) - height - 10;
  left = clamp(left, viewport.left + margin, right - width - margin);
  top = clamp(top, viewport.top + margin, bottom - (previous ? Math.min(120, height) : height) - margin);
  return { left: (left - space.left) / space.scaleX, top: (top - space.top) / space.scaleY,
    maxHeight: Math.max(0, Math.min(480, (bottom - top - margin) / space.scaleY)),
    maxWidth: Math.max(0, (viewport.width - margin * 2) / space.scaleX) };
}

/** Choose the line nearest the mouse release, preserving a snapshot rather than a live Range. */
export function selectionPosition(range: Range, pointer: { x: number; y: number }): Position | undefined {
  try {
    if (!range.startContainer.isConnected || !range.endContainer.isConnected) return;
    const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 || rect.height > 0);
    if (!rects.length) rects.push(range.getBoundingClientRect());
    const distance = (rect: DOMRect) => Math.max(rect.left - pointer.x, 0, pointer.x - rect.right) ** 2
      + Math.max(rect.top - pointer.y, 0, pointer.y - rect.bottom) ** 2;
    const rect = rects.reduce((nearest, candidate) => distance(candidate) < distance(nearest) ? candidate : nearest);
    return { x: rect.left + rect.width / 2, y: rect.bottom + 10, anchorTop: rect.top };
  } catch { return; }
}
