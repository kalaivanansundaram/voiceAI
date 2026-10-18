// What the Mappls problem intake collects, in the order it is asked.
// Each field ends as "answered" (the person said or confirmed it) or "unknown"
// (a visible gap). Nothing is ever filled in silently.

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

export const FIELDS = [
  {
    key: 'reporter',
    label: 'Who is reporting',
    question: 'First, how do you use Mappls — daily commute, driving for work, a fleet, or a business?',
  },
  {
    key: 'problem',
    label: 'Problem in their words',
    question: 'In your own words, what went wrong?',
  },
  {
    key: 'category',
    label: 'Problem type',
    question: 'Which of these is it closest to: map data, navigation and routes, traffic and ETA, search, a business listing, app behaviour, a GPS tracker device, or account and payment?',
  },
  {
    key: 'location',
    label: 'Where',
    question: 'Where did this happen? A locality, landmark, or the route from and to is enough — no need for your home address.',
  },
  {
    key: 'when',
    label: 'When and how often',
    question: 'When did it happen, and how often does it happen?',
  },
  {
    key: 'what_happened',
    label: 'What they saw',
    question: 'Walk me through it: what did you do in the app, and what exactly did you see?',
  },
  {
    key: 'expected',
    label: 'What they expected',
    question: 'What did you expect the app to show or do instead?',
  },
  {
    key: 'impact',
    label: 'Impact',
    question: 'How did it affect you — time lost, extra distance, a missed delivery, or something else?',
  },
  {
    key: 'tried',
    label: 'What they tried',
    question: 'Did you try anything — re-routing, restarting the app, another app? What happened?',
  },
  {
    key: 'device',
    label: 'Phone and app version',
    question: 'Last one: which phone are you using, and the Mappls app version if you know it? It is fine to say you do not know.',
  },
];

export const FIELD_KEYS = FIELDS.map((f) => f.key);
export const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

// observation = the person saw or measured it themselves
// claim       = reported by others, or a generalisation ("always", "everyone")
// assumption  = a guess about cause or fix ("probably the map is outdated")
export const STATEMENT_KINDS = ['observation', 'claim', 'assumption'];
