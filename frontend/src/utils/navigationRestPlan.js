import { navigationRest } from './navigationRest.js';
import { WALKING_BUDGETS } from './walkingBudget.js';

// Page-only preference: compare the validated NEXT intermediate stop, never GPS,
// the destination, an outbound budget/preview, or an inferred substitute.
const boundedCents = value => typeof value === 'number' && Number.isFinite(value) && value > 0
  && value <= Number.MAX_SAFE_INTEGER / 100 && Number.isSafeInteger(Math.round(value * 100));

export function navigationRestPlan(route, index, plan, options = {}) {
  if (!WALKING_BUDGETS.includes(plan)) return null;
  const rest = navigationRest(route, index, options);
  if (rest.state !== 'upcoming' || !boundedCents(rest.distance)
      || !boundedCents(route.distance_m)
      || !boundedCents(route.navigation_rest.segment_lengths_m.reduce((sum, length) => sum + length, 0))) return null;
  // navigationRest exposes hundredths of a metre. Subtract bounded integer
  // hundredths to preserve equality and avoid 59.629999... in the comparison.
  const distanceCents = Math.round(rest.distance * 100);
  const differenceCents = distanceCents - plan * 100;
  const difference = Math.abs(differenceCents) / 100;
  const state = differenceCents > 0 ? 'over' : differenceCents < 0 ? 'under' : 'equal';
  const text = state === 'over' ? `估算超出计划约 ${difference} 米。`
    : state === 'equal' ? `估算恰好等于计划（${plan} 米）。`
      : `估算未超过计划，少约 ${difference} 米。`;
  return { state, distance: rest.distance, difference, text };
}
