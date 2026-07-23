/** Name pools aligned with deliverabilitywizard (proven with InboxKit buy API). */
const FIRST_NAMES = [
  'Marty',
  'Jo',
  'Alex',
  'Sam',
  'Riley',
  'Casey',
  'Jordan',
  'Taylor',
  'Morgan',
  'Quinn',
  'Avery',
  'Reese',
  'Parker',
  'Drew',
  'Blake',
  'Cameron',
  'Hayden',
  'Rowan',
  'Skyler',
  'Emerson',
];

const LAST_NAMES = [
  'Moen',
  'Shmo',
  'Hayes',
  'Brooks',
  'Coleman',
  'Reed',
  'Foster',
  'Bennett',
  'Griffin',
  'Palmer',
  'Walsh',
  'Nash',
  'Keller',
  'Boone',
  'Pratt',
  'Sloan',
  'Vance',
  'Hale',
  'Croft',
  'Lang',
];

export function pickMailboxIdentity(seed: number): {
  first_name: string;
  last_name: string;
  username: string;
} {
  const first = FIRST_NAMES[seed % FIRST_NAMES.length]!;
  const last = LAST_NAMES[Math.floor(seed / FIRST_NAMES.length) % LAST_NAMES.length]!;
  const username = `${first}.${last}${seed}`.toLowerCase().replace(/[^a-z0-9.]/g, '');
  return { first_name: first, last_name: last, username };
}
