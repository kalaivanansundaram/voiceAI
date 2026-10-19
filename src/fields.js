// What the Mappls problem intake collects. Fields are asked in small groups so
// one natural answer can fill several of them — a few turns instead of ten.
// Each field ends as "answered" (the person said or confirmed it) or "unknown"
// (a visible gap). Guesses stay "suggested" until the person approves the
// read-back. Nothing is ever filled in silently.

export const CATEGORIES = {
  map_data: {
    label: 'Map data — road, place name, address, PIN code, landmark',
    route_to: 'Map data team',
  },
  navigation_route: {
    label: 'Navigation & routes — wrong turn, closed road, poor route',
    route_to: 'App feedback + Map data team',
  },
  traffic_eta: {
    label: 'Traffic & ETA — wrong traffic colour or arrival time',
    route_to: 'App feedback team',
  },
  search_places: {
    label: 'Search — place not found or wrong result',
    route_to: 'Search quality & app feedback team',
  },
  business_listing: {
    label: 'Business listing — add, claim, verify or update a business',
    route_to: 'Business listing team',
  },
  app_performance: {
    label: 'App behaviour — crash, slow, GPS jumping, battery, login',
    route_to: 'App feedback team',
  },
  telematics_device: {
    label: 'GPS tracker / telematics device — vehicle not reporting, wrong location',
    route_to: 'Telematics support (vtsupport)',
  },
  account_billing: {
    label: 'Account, subscription or payment',
    route_to: 'Account support',
  },
  other: { label: 'Something else', route_to: 'Feedback team triage' },
};

// `ask` is a short clause; a group's clauses are joined into one spoken question.
export const FIELDS = [
  { key: 'problem', group: 'opening', label: 'Problem in their words', ask: 'what went wrong with Mappls' },
  { key: 'location', group: 'story', label: 'Where', ask: 'where it happened (a locality or route is enough)' },
  { key: 'when', group: 'story', label: 'When and how often', ask: 'when it happened and how often' },
  { key: 'what_happened', group: 'story', label: 'What they saw', ask: 'what exactly you did and saw in the app' },
  { key: 'category', group: 'story', label: 'Problem type', ask: 'whether it is about the map, a route, traffic, search, a business listing, the app itself, a tracker device or your account' },
  { key: 'expected', group: 'outcome', label: 'What they expected', ask: 'what you expected the app to do instead' },
  { key: 'impact', group: 'outcome', label: 'Impact', ask: 'how it affected you' },
  { key: 'tried', group: 'context', label: 'What they tried', ask: 'whether you tried anything to get around it' },
  { key: 'reporter', group: 'context', label: 'Who is reporting', ask: 'how you usually use Mappls (commute, work driving, fleet or business)' },
  { key: 'device', group: 'context', label: 'Phone and app version', ask: 'your phone and app version, if you know' },
];

export const GROUPS = [
  { key: 'opening', lead: 'In your own words, tell me' },
  { key: 'story', lead: 'Tell me what happened:' },
  { key: 'outcome', lead: 'Got it. And' },
  { key: 'context', lead: 'Last bit:' },
];

export const FIELD_KEYS = FIELDS.map((f) => f.key);
export const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

// observation = the person saw or measured it themselves
// claim       = reported by others, or a generalisation ("always", "everyone")
// assumption  = a guess about cause or fix ("probably the map is outdated")
export const STATEMENT_KINDS = ['observation', 'claim', 'assumption'];

export function groupQuestion(group, fieldKeys) {
  const asks = fieldKeys.map((k) => FIELD_BY_KEY[k].ask);
  const list = asks.length === 1 ? asks[0] : `${asks.slice(0, -1).join(', ')} and ${asks.at(-1)}`;
  return `${group.lead} ${list}.`;
}
