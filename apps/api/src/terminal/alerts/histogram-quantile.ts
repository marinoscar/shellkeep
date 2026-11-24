// =============================================================================
// A quantile of a Prometheus-style cumulative histogram (issue #54)
// =============================================================================
//
// Pure. `buckets` maps each bucket's upper bound (`le`, text: `0.5`, `5`, `+Inf`) to the
// CUMULATIVE count of observations at or below it. The answer is the linear
// interpolation inside the bucket that crosses the rank (the same rule the Prometheus
// `histogram_quantile` and the platform's telemetry dashboard use); the `+Inf` bucket
// answers its lower bound. `null` when nothing was observed.
// =============================================================================

/** An upper bound as a number: `+Inf` and `Inf` are infinity, anything unparseable is `null`. */
export function parseBucketBound(le: string): number | null {
  const text = le.trim().toLowerCase();
  if (text === '+inf' || text === 'inf') return Number.POSITIVE_INFINITY;
  if (text === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function histogramQuantile(quantile: number, buckets: ReadonlyMap<string, number>): number | null {
  const bounds = [...buckets.entries()]
    .map(([le, count]) => ({ le: parseBucketBound(le), count }))
    .filter((bucket): bucket is { le: number; count: number } => bucket.le !== null && Number.isFinite(bucket.count))
    .sort((a, b) => a.le - b.le);
  if (bounds.length === 0) return null;

  // Cumulative counts are monotonic; a reset inside the window can break that, so enforce it
  // rather than interpolate backwards.
  for (let i = 1; i < bounds.length; i += 1) bounds[i].count = Math.max(bounds[i].count, bounds[i - 1].count);

  const total = bounds[bounds.length - 1].count;
  if (!(total > 0)) return null;

  const rank = quantile * total;
  for (let i = 0; i < bounds.length; i += 1) {
    const { le, count } = bounds[i];
    if (count < rank) continue;
    if (le === Number.POSITIVE_INFINITY) return i > 0 ? bounds[i - 1].le : null;
    const lower = i > 0 ? bounds[i - 1].le : 0;
    const below = i > 0 ? bounds[i - 1].count : 0;
    const inBucket = count - below;
    if (inBucket <= 0) return le;
    return lower + (le - lower) * ((rank - below) / inBucket);
  }
  return bounds[bounds.length - 1].le;
}
