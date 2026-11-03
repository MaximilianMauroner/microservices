/** Spreadsheet statistics with the sheet's semantics. Each returns null where the sheet formula errors. */

export function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/** STDEV.S: the sample standard deviation. */
export function sampleDeviation(values: readonly number[]): number | null {
  const centre = mean(values);
  if (centre === null || values.length < 2) return null;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - centre) ** 2, 0) / (values.length - 1));
}

type Fit = { n: number; xMean: number; yMean: number; sxx: number; sxy: number; syy: number };

function fit(ys: readonly number[], xs: readonly number[]): Fit | null {
  const n = Math.min(ys.length, xs.length);
  if (n === 0) return null;
  const xMean = xs.reduce((sum, x) => sum + x, 0) / n;
  const yMean = ys.reduce((sum, y) => sum + y, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let index = 0; index < n; index++) {
    const dx = xs[index] - xMean, dy = ys[index] - yMean;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  return { n, xMean, yMean, sxx, sxy, syy };
}

/** SLOPE(ys, xs). */
export function slope(ys: readonly number[], xs: readonly number[]): number | null {
  const f = fit(ys, xs);
  return f && f.sxx > 0 ? f.sxy / f.sxx : null;
}

/** FORECAST(x, ys, xs): the least-squares line evaluated at x. */
export function forecast(x: number, ys: readonly number[], xs: readonly number[]): number | null {
  const f = fit(ys, xs);
  return f && f.sxx > 0 ? f.yMean + (f.sxy / f.sxx) * (x - f.xMean) : null;
}

/** STEYX(ys, xs) / SQRT(DEVSQ(xs)): the standard error of the fitted slope. */
export function slopeError(ys: readonly number[], xs: readonly number[]): number | null {
  const f = fit(ys, xs);
  if (!f || f.n < 3 || f.sxx <= 0) return null;
  return Math.sqrt(Math.max(0, f.syy - (f.sxy * f.sxy) / f.sxx) / (f.n - 2)) / Math.sqrt(f.sxx);
}

/** DEVSQ(xs). */
export function deviationSquares(xs: readonly number[]): number {
  return fit(xs, xs)?.sxx ?? 0;
}

/** RSQ(ys, xs). */
export function rSquared(ys: readonly number[], xs: readonly number[]): number | null {
  const f = fit(ys, xs);
  return f && f.sxx > 0 && f.syy > 0 ? (f.sxy * f.sxy) / (f.sxx * f.syy) : null;
}
