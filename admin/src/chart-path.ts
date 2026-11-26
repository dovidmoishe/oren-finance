const round = (value: number) => Math.round(value * 100) / 100;

/**
 * A smooth SVG path through points (x ascending) that never overshoots them:
 * Steffen's monotone cubic, the same curve as d3's curveMonotoneX. Between two
 * days the line stays within their values, so smoothing never invents a peak.
 */
export function monotonePath(points: [number, number][]) {
  const n = points.length;
  if (n === 0) return "";
  const move = `M${round(points[0][0])},${round(points[0][1])}`;
  if (n === 1) return move;
  if (n === 2) return `${move}L${round(points[1][0])},${round(points[1][1])}`;
  const slopes = points
    .slice(1)
    .map(([x, y], index) => (y - points[index][1]) / (x - points[index][0]));
  const tangents = new Array<number>(n).fill(0);
  for (let index = 1; index < n - 1; index++) {
    const h0 = points[index][0] - points[index - 1][0];
    const h1 = points[index + 1][0] - points[index][0];
    const [s0, s1] = [slopes[index - 1], slopes[index]];
    const blend = (s0 * h1 + s1 * h0) / (h0 + h1);
    tangents[index] =
      (Math.sign(s0) + Math.sign(s1)) *
        Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(blend)) || 0;
  }
  tangents[0] = (3 * slopes[0] - tangents[1]) / 2;
  tangents[n - 1] = (3 * slopes[n - 2] - tangents[n - 2]) / 2;
  let path = move;
  for (let index = 0; index < n - 1; index++) {
    const [x0, y0] = points[index];
    const [x1, y1] = points[index + 1];
    const third = (x1 - x0) / 3;
    path += `C${round(x0 + third)},${round(y0 + tangents[index] * third)} ${round(x1 - third)},${round(y1 - tangents[index + 1] * third)} ${round(x1)},${round(y1)}`;
  }
  return path;
}
