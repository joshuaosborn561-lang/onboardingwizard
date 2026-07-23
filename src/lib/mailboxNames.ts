/** Random male/female first+last pools for InboxKit mailbox identities. */

const MALE_FIRST = [
  'James',
  'Michael',
  'David',
  'Daniel',
  'Matthew',
  'Andrew',
  'Christopher',
  'Joseph',
  'Ryan',
  'Brandon',
  'Justin',
  'Nathan',
  'Tyler',
  'Aaron',
  'Ethan',
  'Noah',
  'Lucas',
  'Owen',
  'Caleb',
  'Hunter',
];

const FEMALE_FIRST = [
  'Emily',
  'Sarah',
  'Jessica',
  'Ashley',
  'Amanda',
  'Megan',
  'Lauren',
  'Rachel',
  'Samantha',
  'Nicole',
  'Stephanie',
  'Katherine',
  'Olivia',
  'Emma',
  'Sophia',
  'Ava',
  'Isabella',
  'Mia',
  'Chloe',
  'Grace',
];

const MALE_LAST = [
  'Carter',
  'Brooks',
  'Hayes',
  'Reed',
  'Bennett',
  'Coleman',
  'Foster',
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
  'Miller',
];

const FEMALE_LAST = [
  'Parker',
  'Collins',
  'Morgan',
  'Foster',
  'Bennett',
  'Sullivan',
  'Reynolds',
  'Hayes',
  'Brooks',
  'Coleman',
  'Mitchell',
  'Powell',
  'Hughes',
  'Flores',
  'Washington',
  'Butler',
  'Simmons',
  'Foster',
  'Bryant',
  'Alexander',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export function pickMailboxIdentity(seed?: number): {
  gender: 'male' | 'female';
  first_name: string;
  last_name: string;
  username: string;
} {
  const gender: 'male' | 'female' =
    seed != null ? (seed % 2 === 0 ? 'male' : 'female') : Math.random() < 0.5 ? 'male' : 'female';

  const first =
    seed != null
      ? (gender === 'male' ? MALE_FIRST : FEMALE_FIRST)[seed % 20]!
      : pick(gender === 'male' ? MALE_FIRST : FEMALE_FIRST);
  const last =
    seed != null
      ? (gender === 'male' ? MALE_LAST : FEMALE_LAST)[
          Math.floor(seed / 20) % 20
        ]!
      : pick(gender === 'male' ? MALE_LAST : FEMALE_LAST);

  const suffix = seed != null ? String(seed) : String(Math.floor(Math.random() * 90) + 10);
  const username = `${first}.${last}${suffix}`.toLowerCase().replace(/[^a-z0-9.]/g, '');

  return { gender, first_name: first, last_name: last, username };
}
