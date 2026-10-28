export function matchSpokenPlace(text, options) {
  const normalize = value => String(value).replace(/[\s，。！？、,.!?]/g, '').replace(/^(我想去|我要去|去|目的地是|出发地是)/, '');
  const query = normalize(text);
  if (!query) return null;
  const exact = options.filter(option => normalize(option.label) === query);
  if (exact.length === 1) return exact[0].value;
  const matches = options.filter(option => query.includes(normalize(option.label)) || (query.length >= 3 && normalize(option.label).includes(query)));
  return matches.length === 1 ? matches[0].value : null;
}
