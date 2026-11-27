// A proposal only: no geometry, persistence, location or planning side effects.
export function returnJourneyDraft(snapshot, context, startOptions, endOptions) {
  if (!snapshot?.allowed || snapshot.detour || snapshot.currentOrigin
      || !context?.allowed || context.detour || context.currentOrigin || !context.route) return null;
  if (snapshot.route !== context.route || snapshot.scope !== context.scope
      || snapshot.start !== context.start || snapshot.end !== context.end
      || snapshot.mobility !== context.mobility || snapshot.strategy !== context.strategy) return null;
  const named = value => typeof value === 'string' && value.trim() === value && value.length > 0;
  const registered = (options, value) => Array.isArray(options)
    && options.some(option => option?.value === value && named(option.label));
  if (!named(snapshot.start) || !named(snapshot.end) || snapshot.start === snapshot.end
      || !registered(startOptions, snapshot.start) || !registered(endOptions, snapshot.end)
      || !registered(startOptions, snapshot.end) || !registered(endOptions, snapshot.start)) return null;
  return { start: snapshot.end, end: snapshot.start };
}
