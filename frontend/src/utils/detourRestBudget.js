import { parseNavigationRest } from './navigationRest.js';
import { WALKING_BUDGETS } from './walkingBudget.js';

const named = value => typeof value === 'string' && value.trim().length > 0;
const cents = value => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0
      || value > Number.MAX_SAFE_INTEGER / 100) return null;
  const result = Math.round(value * 100);
  return Number.isSafeInteger(result) && result > 0 ? result : null;
};

// Capture only the relevant DTO evidence before awaiting a candidate. Never
// borrow rest_preview, another route's catalogue, or infer stops from geometry.
export function snapshotRegisteredRoute(route) {
  const meta = parseNavigationRest(route);
  if (!meta || route.start_context) return null;
  return { distance_m: route.distance_m, segment_codes: [...route.segment_codes],
    segments: route.segments.map(row => ({ segment_code: row.segment_code, length_m: row.length_m })),
    navigation_rest: { version: meta.version, source: meta.source, segment_codes: [...meta.segment_codes],
      node_codes: [...meta.node_codes], segment_lengths_m: [...meta.segment_lengths_m],
      stops: meta.stops.map(stop => ({ ...stop })) } };
}

function registeredWalk(route, meta, budget, startName, endName) {
  const lengths = meta.segment_lengths_m.map(cents), total = cents(route.distance_m);
  if (total === null || lengths.some(value => value === null)) return null;
  let sum = 0;
  for (const length of lengths) {
    sum += length;
    if (!Number.isSafeInteger(sum)) return null;
  }
  if (sum !== total) return null;
  // A known empty catalogue still proves one continuous registered interval.
  // Endpoint rest records do not split or rename the requested endpoints.
  const stops = meta.stops.filter(stop => stop.node_index > 0 && stop.node_index < lengths.length);
  const boundaries = [{ node_index: 0, name: startName }, ...stops, { node_index: lengths.length, name: endName }];
  const intervals = boundaries.slice(1).map((stop, i) => ({ from: boundaries[i].name, to: stop.name,
    distanceCents: lengths.slice(boundaries[i].node_index, stop.node_index).reduce((a, b) => a + b, 0) }));
  const longestCents = intervals.reduce((longest, interval) => Math.max(longest, interval.distanceCents), 0);
  const cap = WALKING_BUDGETS.includes(budget) ? budget * 100 : null;
  const firstOverLimit = cap === null ? null : intervals.find(interval => interval.distanceCents > cap);
  const display = interval => interval ? { from: interval.from, to: interval.to, distance: interval.distanceCents / 100 } : null;
  return { totalCents: total, longestCents, facts: { total: total / 100, longest: longestCents / 100,
    intervals: intervals.map(display), meetsBudget: cap === null ? null : longestCents <= cap,
    firstOverLimit: display(firstOverLimit),
    firstOverLimitExcess: firstOverLimit ? (firstOverLimit.distanceCents - cap) / 100 : null } };
}

export function detourRestBudgetFacts(preview, budget) {
  const evidence = preview?.restBudgetEvidence;
  if (evidence?.contextVerified !== true || !named(evidence.startName) || !named(evidence.endName)) return null;
  const baseline = evidence.baselineRoute, candidate = preview.route;
  const originalMeta = parseNavigationRest(baseline), candidateMeta = parseNavigationRest(candidate);
  if (!originalMeta || !candidateMeta || baseline.start_context || candidate.start_context
      || originalMeta.node_codes[0] !== candidateMeta.node_codes[0]
      || originalMeta.node_codes.at(-1) !== candidateMeta.node_codes.at(-1)) return null;
  const original = registeredWalk(baseline, originalMeta, budget, evidence.startName, evidence.endName);
  const proposed = registeredWalk(candidate, candidateMeta, budget, evidence.startName, evidence.endName);
  if (!original || !proposed) return null;
  return { original: original.facts, candidate: proposed.facts,
    continuousDifference: (proposed.longestCents - original.longestCents) / 100,
    totalDifference: (proposed.totalCents - original.totalCents) / 100 };
}
