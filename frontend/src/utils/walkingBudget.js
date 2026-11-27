// Optional pre-departure calculation for the SAME bounded rest candidate.
// No routing, GPS, API requests, ranking, inference or navigation mutation.
export const WALKING_BUDGETS = Object.freeze([100, 200, 300]);
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const named = value => typeof value === 'string' && value.trim().length > 0;
export function walkingBudgetFacts(preview, budget) {
  const codes = preview?.segment_codes, lengths = preview?.segment_lengths_m;
  const index = preview?.stop_after_segment_index;
  if (!named(preview?.stop_name) || !positive(preview?.distance_m) || !positive(preview?.baseline_distance_m)
      || !Array.isArray(codes) || codes.length < 2 || !codes.every(named) || new Set(codes).size !== codes.length
      || !Array.isArray(preview.segment_names) || preview.segment_names.length !== codes.length || !preview.segment_names.every(named)
      || !Array.isArray(lengths) || lengths.length !== codes.length || !lengths.every(positive)
      || !Number.isInteger(index) || index < 0 || index >= codes.length - 1
      || typeof preview.matches_baseline !== 'boolean') return null;
  const first = lengths.slice(0, index + 1).reduce((sum, value) => sum + value, 0);
  const second = lengths.slice(index + 1).reduce((sum, value) => sum + value, 0);
  const total = first + second;
  // The existing API total is rounded to two decimals. Do not repair a
  // contradictory payload or reconstruct a missing leg by subtraction.
  if (!positive(first) || !positive(second) || !Number.isFinite(total)
      || Math.round(total * 100) / 100 !== preview.distance_m
      || (preview.matches_baseline && preview.distance_m !== preview.baseline_distance_m)) return null;
  const longest = Math.max(first, second);
  return { first, second, longest, total: preview.distance_m, baseline: preview.baseline_distance_m,
    meetsBudget: WALKING_BUDGETS.includes(budget) ? longest <= budget : null,
    continuousDifference: longest - preview.baseline_distance_m,
    totalDifference: preview.distance_m - preview.baseline_distance_m };
}
