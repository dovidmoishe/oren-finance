export const STEP_DURATIONS = [2200, 2600, 4400, 2800] as const;
export const STEP_STARTS = STEP_DURATIONS.map((_, i) => STEP_DURATIONS.slice(0, i).reduce<number>((sum, ms) => sum + ms, 0));
export const WALKTHROUGH_DURATION = STEP_DURATIONS.reduce<number>((sum, ms) => sum + ms, 0);

export function walkthroughPosition(elapsed: number) {
  const time = Math.min(WALKTHROUGH_DURATION, Math.max(0, elapsed));
  const step = STEP_STARTS.findLastIndex(start => time >= start);
  return { step, local: (time - STEP_STARTS[step]) / STEP_DURATIONS[step] * 6000, ended: time >= WALKTHROUGH_DURATION };
}

export function chartGeometry(prices: number[]) {
  const valid = prices.filter(Number.isFinite);
  const min = Math.min(...valid); const max = Math.max(...valid);
  const pad = Math.max((max - min) * .08, max * .002, .01);
  const low = min - pad; const high = max + pad;
  const y = (price: number) => 195 - (price - low) / (high - low) * 180;
  return {
    path: valid.map((price, i) => `${i ? 'L' : 'M'}${(i / Math.max(1, valid.length - 1) * 500).toFixed(2)} ${y(price).toFixed(2)}`).join(' '),
    ticks: Array.from({ length: 4 }, (_, i) => high - (high - low) * i / 3),
    y,
  };
}
