import { expect, it, vi } from 'vitest';
import { coordinateSpace, positionPopup, selectionPosition, visibleViewport } from './popup-position';
const identity = { left: 0, top: 0, scaleX: 1, scaleY: 1 };
it('clamps into an offset visual viewport and maps through a translated/scaled host', () => {
  const viewport = { left: 100, top: 80, width: 300, height: 400 };
  const space = { left: 20, top: 30, scaleX: 2, scaleY: 2 };
  const result = positionPopup({ x: 20, y: 500, anchorTop: 450 }, { width: 420, height: 300 }, viewport, space);
  expect(result.left * 2 + 20).toBe(112);
  expect(result.top * 2 + 30).toBe(140);
  expect(result.maxWidth).toBe(138);
  expect(result.maxHeight).toBe(164);
});
it('keeps interacted controls steady as content grows and clamps after viewport shrink', () => {
  const previous = { left: 40, top: 420 };
  expect(positionPopup({ x: 200, y: 100 }, { width: 420, height: 480 }, { left: 0, top: 0, width: 800, height: 700 }, identity, previous))
    .toMatchObject({ left: 40, top: 420, maxHeight: 268 });
  const small = positionPopup({ x: 200, y: 100 }, { width: 420, height: 480 }, { left: 0, top: 0, width: 320, height: 200 }, identity, previous);
  expect(small.left).toBe(12); expect(small.top).toBe(68); expect(small.maxHeight).toBe(120);
});
it('measures fixed coordinate calibration and visualViewport offsets', () => {
  const probe = { offsetWidth: 100, offsetHeight: 100, getBoundingClientRect: () => ({ left: 15, top: 25, width: 150, height: 200 }) } as HTMLElement;
  expect(coordinateSpace(probe)).toEqual({ left: 15, top: 25, scaleX: 1.5, scaleY: 2 });
  vi.stubGlobal('visualViewport', { offsetLeft: 10, offsetTop: 20, width: 300, height: 400 });
  expect(visibleViewport()).toEqual({ left: 10, top: 20, width: 300, height: 400 }); vi.unstubAllGlobals();
});
it('anchors multi-line/reverse selections at the pointer line and rejects detached ranges', () => {
  const rects = [{ left: 10, right: 100, top: 10, bottom: 30, width: 90, height: 20 }, { left: 10, right: 50, top: 40, bottom: 60, width: 40, height: 20 }];
  const node = document.createTextNode('fixture'); document.body.append(node);
  const range = { startContainer: node, endContainer: node, getClientRects: () => rects } as unknown as Range;
  expect(selectionPosition(range, { x: 12, y: 12 })).toEqual({ x: 55, y: 40, anchorTop: 10 });
  expect(selectionPosition(range, { x: 45, y: 55 })).toEqual({ x: 30, y: 70, anchorTop: 40 });
  node.remove(); expect(selectionPosition(range, { x: 0, y: 0 })).toBeUndefined();
});
