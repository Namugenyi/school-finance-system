/** Categorical slots 1-3 from the validated reference palette (light mode), assigned in fixed order. */
export const SERIES = { s1: '#2a78d6', s2: '#eb6834', s3: '#1baf7a' };
export const AXIS = { stroke: '#94a3b8', fontSize: 12, tickColor: '#475569' };
export const GRID = '#e2e8f0';
export const compactUGX = (v: number) =>
  Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : Math.abs(v) >= 1_000 ? `${Math.round(v / 1_000)}k` : String(v);
