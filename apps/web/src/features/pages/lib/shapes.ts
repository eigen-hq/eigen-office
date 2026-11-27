import type { InkPoint } from './ink';

/*
 * A form drawn by hand and held still at its end, drawn true (as Apple's shape recognition): a
 * line, a few straight strokes (an arrow, an angle), a triangle, a box, a circle or an ellipse,
 * any other closed polygon of straight sides. Its corners come back; `null` when it is none.
 */

const distance = (a: InkPoint, b: InkPoint) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** How far the point lies from the line through a and b. */
function off(point: InkPoint, a: InkPoint, b: InkPoint): number {
  const length = distance(a, b);
  if (length === 0) return distance(point, a);
  return Math.abs((b[0] - a[0]) * (a[1] - point[1]) - (a[0] - point[0]) * (b[1] - a[1])) / length;
}

/** Ramer–Douglas–Peucker: the corners that keep every point within `tolerance`. */
function corners(points: readonly InkPoint[], tolerance: number): InkPoint[] {
  if (points.length < 3) return [...points];
  const first = points[0]!;
  const last = points.at(-1)!;
  let far = 0;
  let at = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const d = off(points[index]!, first, last);
    if (d > far) {
      far = d;
      at = index;
    }
  }
  if (far <= tolerance) return [first, last];
  return [
    ...corners(points.slice(0, at + 1), tolerance).slice(0, -1),
    ...corners(points.slice(at), tolerance),
  ];
}

/** An angle near 0°, 45° or 90° (and so on) made so: lines straight across, up and diagonal. */
function squared(a: InkPoint, b: InkPoint): InkPoint {
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const step = Math.PI / 4;
  const near = Math.round(angle / step) * step;
  if (Math.abs(angle - near) > (5 * Math.PI) / 180) return b;
  const length = distance(a, b);
  return [a[0] + Math.cos(near) * length, a[1] + Math.sin(near) * length];
}

function ellipse(cx: number, cy: number, rx: number, ry: number): InkPoint[] {
  const steps = Math.max(36, Math.min(120, Math.round((rx + ry) / 4)));
  return Array.from({ length: steps + 1 }, (_, at) => {
    const t = (at / steps) * Math.PI * 2 - Math.PI / 2;
    return [cx + Math.cos(t) * rx, cy + Math.sin(t) * ry] as const;
  });
}

const angleAt = (before: InkPoint, at: InkPoint, after: InkPoint) => {
  const a = Math.atan2(before[1] - at[1], before[0] - at[0]);
  const b = Math.atan2(after[1] - at[1], after[0] - at[0]);
  let d = Math.abs(a - b);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return (d * 180) / Math.PI;
};

export function recognize(points: readonly InkPoint[]): InkPoint[] | null {
  if (points.length < 4) return null;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const size = Math.hypot(right - left, bottom - top);
  if (size < 24) return null;
  const first = points[0]!;
  const last = points.at(-1)!;
  const closed = distance(first, last) < Math.max(20, size * 0.2);

  if (!closed) {
    // Straight: one line, squared to the axes and diagonals when near them.
    const far = Math.max(...points.map((point) => off(point, first, last)));
    if (far < Math.max(4, distance(first, last) * 0.06)) return [first, squared(first, last)];
    // A few straight strokes in one (an arrow, an angle, a zigzag).
    const kept = corners(points, Math.max(4, size * 0.045));
    if (kept.length <= 5) return kept;
    return null;
  }

  // Closed: a polygon of straight sides, or round.
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const rx = (right - left) / 2;
  const ry = (bottom - top) / 2;
  const loop = corners([...points, first], Math.max(5, size * 0.06)).slice(0, -1);
  if (loop.length >= 3 && loop.length <= 6) {
    const sides = loop.map((point, at) => [point, loop[(at + 1) % loop.length]!] as const);
    const straight = points.every((point) =>
      sides.some(([a, b]) => off(point, a, b) < Math.max(6, size * 0.07)),
    );
    if (straight) {
      if (loop.length === 4) {
        const square = loop.every(
          (point, at) =>
            Math.abs(angleAt(loop[(at + 3) % 4]!, point, loop[(at + 1) % 4]!) - 90) < 16,
        );
        // A box near the axes: drawn as its bounds.
        const tilted = Math.abs(
          Math.atan2(loop[1]![1] - loop[0]![1], loop[1]![0] - loop[0]![0]) % (Math.PI / 2),
        );
        const level = tilted < 0.14 || Math.PI / 2 - tilted < 0.14;
        if (square && level) {
          return [
            [left, top],
            [right, top],
            [right, bottom],
            [left, bottom],
            [left, top],
          ];
        }
      }
      return [...loop, loop[0]!];
    }
  }
  // Round: every point near the ellipse in the stroke's bounds.
  if (rx > 6 && ry > 6) {
    const error =
      points.reduce(
        (sum, [x, y]) => sum + Math.abs(Math.hypot((x - cx) / rx, (y - cy) / ry) - 1),
        0,
      ) / points.length;
    if (error < 0.12) {
      // Nearly a circle: a circle.
      if (Math.abs(rx - ry) / Math.max(rx, ry) < 0.12) {
        const r = (rx + ry) / 2;
        return ellipse(cx, cy, r, r);
      }
      return ellipse(cx, cy, rx, ry);
    }
  }
  return null;
}
