// Cheap keyword heuristics used when no LLM labels the statements (the guided
// text test), and as a first guess for the problem type. The person can always
// correct both during review.

const ASSUMPTION = /\b(i think|i guess|i feel|i believe|i suspect|maybe|probably|perhaps|might|may be|must be|should be|seems|assume|likely|shayad|lagta hai)\b/i;
const CLAIM = /\b(always|never|everyone|everybody|nobody|all (the )?users|people say|they say|they said|friends|customers say|users say|every time|all the time|known issue|heard)\b/i;
const FIRST_HAND = /\b(i|we|my|me|our|us|mera|maine)\b|\d/i;

export function splitSentences(text) {
  return String(text)
    .split(/(?<=[.!?।])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

export function classifySentence(sentence) {
  if (ASSUMPTION.test(sentence)) return 'assumption';
  if (CLAIM.test(sentence)) return 'claim';
  return FIRST_HAND.test(sentence) ? 'observation' : 'claim';
}

export function classifyStatements(text) {
  return splitSentences(text).map((t) => ({ text: t, kind: classifySentence(t) }));
}

// First match wins, so the more specific categories come first.
const CATEGORY_RULES = [
  ['telematics_device', /\b(tracker|gps device|vehicle tracking|device id|delink|ignition|fleet device|vts)\b/i],
  ['business_listing', /\b(my (shop|business|store|restaurant|clinic|office)|listing|claim|verify (my )?business|business (hours|timing|number))\b/i],
  ['traffic_eta', /\b(traffic|eta|arrival time|jam|congestion|reach(ed)? late)\b/i],
  ['navigation_route', /\b(route|routing|navigation|navigate|turn|u-turn|reroute|re-route|directions|took me|closed road|toll|wrong way|one[- ]way)\b/i],
  ['map_data', /\b(road (is )?missing|new road|wrong name|spelling|pin ?code|village|address|landmark|place name|boundary|map is wrong|not on the map)\b/i],
  ['search_places', /\b(search|can'?t find|cannot find|not showing|no results?|wrong result)\b/i],
  ['app_performance', /\b(crash|slow|freez|hang|battery|lag|gps (signal|jump)|location jump|drift|login|otp|blank screen)\b/i],
  ['account_billing', /\b(subscription|payment|renewal|refund|charged|account|premium)\b/i],
];

export function guessCategory(text) {
  for (const [key, re] of CATEGORY_RULES) if (re.test(text)) return key;
  return null;
}
