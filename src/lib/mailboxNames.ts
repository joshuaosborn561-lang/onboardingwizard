/**
 * InboxKit-wizard-style mailbox identities.
 *
 * Allocates culturally coherent first+last pairs with unique first names
 * and unique last names across the whole batch (not just per domain).
 */

export interface MailboxIdentity {
  gender: 'male' | 'female';
  first_name: string;
  last_name: string;
  username: string;
}

interface NameCohort {
  label: string;
  maleFirst: string[];
  femaleFirst: string[];
  lasts: string[];
}

/**
 * Cohorts keep first/last culturally aligned (like InboxKit's wizard),
 * while the allocator mixes cohorts so a batch is not all one ethnicity.
 */
const COHORTS: NameCohort[] = [
  {
    label: 'anglo',
    maleFirst: [
      'James', 'Michael', 'David', 'Daniel', 'Matthew', 'Andrew', 'Christopher',
      'Joseph', 'Ryan', 'Brandon', 'Nathan', 'Tyler', 'Ethan', 'Noah', 'Lucas',
      'Owen', 'Caleb', 'Liam', 'Mason', 'Logan', 'Jackson', 'Aiden', 'Henry',
      'Jack', 'Leo', 'Julian', 'Wyatt', 'Luke', 'Isaac', 'Thomas', 'Charles',
      'Benjamin', 'Samuel', 'Oliver', 'Sebastian', 'Connor', 'Patrick', 'Kevin',
      'Brian', 'Sean', 'Declan', 'Callum', 'Finn', 'Grant', 'Cole', 'Blake',
    ],
    femaleFirst: [
      'Emily', 'Sarah', 'Jessica', 'Ashley', 'Amanda', 'Megan', 'Lauren', 'Rachel',
      'Samantha', 'Nicole', 'Olivia', 'Emma', 'Sophia', 'Ava', 'Isabella', 'Mia',
      'Chloe', 'Grace', 'Hannah', 'Abigail', 'Elizabeth', 'Charlotte', 'Amelia',
      'Harper', 'Evelyn', 'Ella', 'Victoria', 'Lily', 'Zoe', 'Natalie', 'Claire',
      'Brooke', 'Allison', 'Julia', 'Katherine', 'Rebecca', 'Morgan', 'Quinn',
      'Caitlin', 'Brianna', 'Nora', 'Freya', 'Clara',
    ],
    lasts: [
      'Carter', 'Brooks', 'Hayes', 'Reed', 'Bennett', 'Coleman', 'Griffin', 'Palmer',
      'Walsh', 'Keller', 'Boone', 'Pratt', 'Sloan', 'Vance', 'Hale', 'Croft', 'Lang',
      'Miller', 'Parker', 'Collins', 'Sullivan', 'Reynolds', 'Mitchell', 'Powell',
      'Hughes', 'Butler', 'Simmons', 'Stewart', 'Morris', 'Rogers', 'Cook', 'Bell',
      'Murphy', 'Bailey', 'Cooper', 'Richardson', 'Howard', 'Ward', 'Peterson',
      'Gray', 'Watson', 'Kelly', 'Sanders', 'Price', 'Wood', 'Barnes', 'Ross',
      'Henderson', 'Jenkins', 'Perry', 'Long', 'Patterson', 'Foster', 'Russell',
      'Anderson', 'Thompson', 'White', 'Harris', 'Clark', 'Lewis', 'Walker',
      'Allen', 'Young', 'King', 'Wright', 'Scott', 'Green', 'Adams', 'Nelson',
      'Baker', 'Hall', 'Campbell', 'Edwards', 'Phillips', 'Evans', 'Turner',
    ],
  },
  {
    label: 'hispanic',
    maleFirst: [
      'Carlos', 'Diego', 'Miguel', 'Javier', 'Luis', 'Antonio', 'Fernando', 'Ricardo',
      'Alejandro', 'Andres', 'Mateo', 'Santiago', 'Emilio', 'Rafael', 'Pablo', 'Hector',
      'Manuel', 'Pedro', 'Adrian', 'Eduardo', 'Gabriel', 'Oscar', 'Roberto', 'Francisco',
      'Joaquin', 'Nicolas', 'Sebastian', 'Ivan', 'Marco', 'Angel',
    ],
    femaleFirst: [
      'Maria', 'Sofia', 'Camila', 'Valentina', 'Lucia', 'Isabela', 'Elena', 'Carmen',
      'Gabriela', 'Daniela', 'Ana', 'Rosa', 'Paola', 'Mariana', 'Jimena', 'Alejandra',
      'Catalina', 'Ximena', 'Renata', 'Paloma', 'Andrea', 'Natalia', 'Valeria',
      'Fernanda', 'Adriana', 'Monica', 'Claudia', 'Diana', 'Patricia', 'Laura',
    ],
    lasts: [
      'Garcia', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Perez',
      'Sanchez', 'Ramirez', 'Torres', 'Flores', 'Rivera', 'Gomez', 'Diaz', 'Reyes',
      'Morales', 'Cruz', 'Ortiz', 'Gutierrez', 'Chavez', 'Ramos', 'Vargas', 'Castillo',
      'Jimenez', 'Moreno', 'Romero', 'Herrera', 'Medina', 'Aguilar', 'Ruiz', 'Mendoza',
      'Guerrero', 'Alvarez', 'Navarro', 'Dominguez', 'Vega', 'Soto', 'Delgado',
    ],
  },
  {
    label: 'black',
    maleFirst: [
      'Marcus', 'Andre', 'Darius', 'Malik', 'Xavier', 'Desmond', 'Isaiah', 'Jeremiah',
      'Elijah', 'Josiah', 'Kendrick', 'Lamar', 'Jamal', 'Omari', 'Jabari', 'Kwame',
      'Terrell', 'Darnell', 'Cameron', 'Jordan', 'Jaylen', 'Donovan', 'Tristan',
      'Caleb', 'Nathaniel', 'Christian', 'Anthony', 'Brandon', 'Corey', 'Dante',
    ],
    femaleFirst: [
      'Aaliyah', 'Nia', 'Imani', 'Jasmine', 'Tiana', 'Amara', 'Zuri', 'Aisha',
      'Kiara', 'Simone', 'Ayana', 'Maya', 'Naomi', 'Destiny', 'Asia', 'Monique',
      'Sanaa', 'Fatima', 'Kayla', 'Brielle', 'Jada', 'Morgan', 'Taylor', 'Alicia',
      'Danielle', 'Stephanie', 'Tiffany', 'Alexis', 'Brittany', 'Nicole',
    ],
    lasts: [
      'Washington', 'Jefferson', 'Banks', 'Booker', 'Freeman', 'Haynes', 'Mosley',
      'Parks', 'Williams', 'Johnson', 'Jackson', 'Brown', 'Davis', 'Harris',
      'Robinson', 'Walker', 'Scott', 'Green', 'Adams', 'Nelson', 'Brooks', 'Coleman',
      'Jenkins', 'Bryant', 'Porter', 'Fleming', 'Hudson', 'Grant', 'Hawkins',
      'Okoro', 'Okafor', 'Adebayo', 'Mensah', 'Owusu', 'Diallo', 'Keita', 'Traore',
      'Boateng', 'Asante', 'Nwosu', 'Osei',
    ],
  },
  {
    label: 'east_asian',
    maleFirst: [
      'Wei', 'Kai', 'Hiro', 'Kenji', 'Jin', 'Ren', 'Haruto', 'Yuki', 'Sora', 'Min',
      'Hao', 'Jun', 'Tao', 'Cheng', 'Liang', 'Ming', 'Dong', 'Feng', 'Joon', 'Hyun',
      'Minho', 'Seung', 'Takeshi', 'Ryo', 'Daiki', 'Kenta',
    ],
    femaleFirst: [
      'Mei', 'Yuki', 'Hana', 'Aiko', 'Yuna', 'Jiwoo', 'Minji', 'Suki', 'Sakura',
      'Ling', 'Xia', 'Jing', 'Fang', 'Yan', 'Qing', 'Nari', 'Soojin', 'Hyejin',
      'Akari', 'Emi', 'Rina', 'Miyu', 'Asuka', 'Natsuki',
    ],
    lasts: [
      'Wang', 'Li', 'Zhang', 'Chen', 'Liu', 'Yang', 'Huang', 'Zhao', 'Wu', 'Zhou',
      'Kim', 'Park', 'Choi', 'Jung', 'Kang', 'Cho', 'Yoon', 'Han', 'Oh', 'Shin',
      'Tanaka', 'Suzuki', 'Sato', 'Watanabe', 'Takahashi', 'Ito', 'Yamamoto',
      'Nakamura', 'Kobayashi', 'Matsumoto', 'Xu', 'Sun', 'Ma', 'Guo', 'Lin',
    ],
  },
  {
    label: 'south_asian',
    maleFirst: [
      'Ravi', 'Arjun', 'Rohan', 'Vikram', 'Amit', 'Raj', 'Sanjay', 'Anand', 'Dev',
      'Aarav', 'Vihaan', 'Kabir', 'Ishaan', 'Aditya', 'Nikhil', 'Rahul', 'Karan',
      'Siddharth', 'Varun', 'Pranav', 'Ayaan', 'Zain', 'Imran', 'Farhan',
    ],
    femaleFirst: [
      'Priya', 'Ananya', 'Isha', 'Neha', 'Sanya', 'Diya', 'Kavya', 'Aanya', 'Maya',
      'Anika', 'Meera', 'Riya', 'Pooja', 'Shreya', 'Aditi', 'Nisha', 'Sneha',
      'Aisha', 'Zara', 'Fatima', 'Sara', 'Noor', 'Ayesha', 'Hira',
    ],
    lasts: [
      'Patel', 'Sharma', 'Singh', 'Kumar', 'Shah', 'Gupta', 'Khan', 'Ali', 'Ahmed',
      'Rahman', 'Chowdhury', 'Das', 'Reddy', 'Nair', 'Iyer', 'Mehta', 'Joshi',
      'Malik', 'Hassan', 'Hussain', 'Kapoor', 'Chopra', 'Banerjee', 'Mukherjee',
      'Desai', 'Rao', 'Menon', 'Pillai', 'Bhat', 'Chaudhary',
    ],
  },
  {
    label: 'vietnamese',
    maleFirst: [
      'Minh', 'Huy', 'Bao', 'Tuan', 'Duc', 'Long', 'Nam', 'Quan', 'Khoa', 'Vinh',
      'Hung', 'Dat', 'Khai', 'Phong', 'Thanh',
    ],
    femaleFirst: [
      'Linh', 'Mai', 'Trang', 'Ngoc', 'Thao', 'Huong', 'Lan', 'Anh', 'Hien', 'Yen',
      'My', 'Ha', 'Chi', 'Thu', 'Quynh',
    ],
    lasts: [
      'Nguyen', 'Tran', 'Le', 'Pham', 'Hoang', 'Vu', 'Dang', 'Bui', 'Do', 'Ngo',
      'Vo', 'Duong', 'Phan', 'Huynh', 'Truong',
    ],
  },
  {
    label: 'filipino',
    maleFirst: [
      'Jose', 'Miguel', 'Rafael', 'Andrei', 'Carlo', 'Paolo', 'Gabriel', 'Joshua',
      'Mark', 'John', 'Christian', 'Daniel', 'Nathan', 'Ryan',
    ],
    femaleFirst: [
      'Maria', 'Angela', 'Grace', 'Joy', 'Kristine', 'Patricia', 'Michelle',
      'Andrea', 'Nicole', 'Samantha', 'Catherine', 'Jasmine', 'Bianca', 'Sofia',
    ],
    lasts: [
      'Santos', 'Reyes', 'Cruz', 'Garcia', 'DelaCruz', 'Ramos', 'Torres', 'Mendoza',
      'Bautista', 'Villanueva', 'Aquino', 'Fernandez', 'Gonzales', 'Castillo',
    ],
  },
  {
    label: 'mena',
    maleFirst: [
      'Omar', 'Hassan', 'Amir', 'Yusuf', 'Karim', 'Samir', 'Tariq', 'Nabil', 'Rami',
      'Zaid', 'Idris', 'Farid', 'Bilal', 'Imran', 'Khalid', 'Walid', 'Sami', 'Adel',
      'Youssef', 'Ibrahim', 'Mustafa', 'Hamza', 'Ziad', 'Faisal',
    ],
    femaleFirst: [
      'Layla', 'Noor', 'Yasmin', 'Amira', 'Leila', 'Sara', 'Maryam', 'Zara', 'Dina',
      'Rania', 'Salma', 'Nadia', 'Farah', 'Hana', 'Lina', 'Maya', 'Samira', 'Amina',
      'Nour', 'Reem', 'Dana', 'Jana', 'Mariam', 'Heba',
    ],
    lasts: [
      'Hassan', 'Hussein', 'Abbas', 'Farouk', 'Nasser', 'Said', 'Habib', 'Karim',
      'Mansour', 'Rahman', 'Saleh', 'Youssef', 'Amari', 'Bazzi', 'Khoury', 'Haddad',
      'Khalil', 'Nader', 'Farah', 'Said', 'Osman', 'Ibrahim', 'Mahmoud', 'Aziz',
    ],
  },
  {
    label: 'slavic',
    maleFirst: [
      'Dmitri', 'Nikolas', 'Alexei', 'Viktor', 'Sergei', 'Pavel', 'Marek', 'Tomasz',
      'Andrei', 'Ivan', 'Mikhail', 'Nikolai', 'Roman', 'Boris', 'Stefan', 'Lukas',
      'Jakub', 'Mateusz', 'Piotr', 'Adam',
    ],
    femaleFirst: [
      'Anya', 'Katya', 'Natasha', 'Irina', 'Olga', 'Svetlana', 'Mila', 'Kasia',
      'Elena', 'Natalia', 'Sofia', 'Anna', 'Magdalena', 'Agnieszka', 'Zuzanna',
      'Oksana', 'Yulia', 'Daria', 'Alina', 'Vera',
    ],
    lasts: [
      'Ivanov', 'Petrov', 'Sokolov', 'Volkov', 'Novak', 'Kowalski', 'Nowak',
      'Wisniewski', 'Horvat', 'Kovacs', 'Nagy', 'Popov', 'Jovanovic', 'Kozlov',
      'Morozov', 'Smirnov', 'Wojcik', 'Kaminski', 'Lewandowski', 'Zielinski',
    ],
  },
  {
    label: 'romance_nordic',
    maleFirst: [
      'Enzo', 'Luca', 'Marco', 'Giovanni', 'Nico', 'Felix', 'Maximilian', 'Otto',
      'Lorenzo', 'Matteo', 'Alessandro', 'Francesco', 'Leonardo', 'Theo', 'Hugo',
      'Louis', 'Antoine', 'Pierre', 'Erik', 'Lars', 'Anders', 'Nils',
    ],
    femaleFirst: [
      'Giulia', 'Chiara', 'Francesca', 'Bianca', 'Ines', 'Clara', 'Nora', 'Freya',
      'Sofia', 'Alessia', 'Valentina', 'Camille', 'Elise', 'Juliette', 'Amelie',
      'Astrid', 'Ingrid', 'Linnea', 'Ebba', 'Saga',
    ],
    lasts: [
      'Rossi', 'Ferrari', 'Esposito', 'Romano', 'Conti', 'Ricci', 'Moretti',
      'Costa', 'Silva', 'Santos', 'Oliveira', 'Pereira', 'Almeida', 'Fernandes',
      'Andersson', 'Johansson', 'Nielsen', 'Larsen', 'Berg', 'Olsen', 'Eriksson',
      'Dupont', 'Martin', 'Bernard', 'Petit', 'Moreau',
    ],
  },
];

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function asciiUsernamePart(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function makeUsername(first: string, last: string, used: Set<string>): string {
  const base = `${asciiUsernamePart(first)}.${asciiUsernamePart(last)}` || 'user';
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}${n}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  const fallback = `${base}${Math.floor(Math.random() * 9000) + 1000}`;
  used.add(fallback);
  return fallback;
}

/** Build a large shuffled deck of culturally coherent pairs with unique first+last. */
function buildCoherentPairDeck(): Array<{
  gender: 'male' | 'female';
  first_name: string;
  last_name: string;
}> {
  const usedFirst = new Set<string>();
  const usedLast = new Set<string>();
  const pairs: Array<{ gender: 'male' | 'female'; first_name: string; last_name: string }> = [];

  for (const cohort of shuffle(COHORTS)) {
    const males = shuffle(uniq(cohort.maleFirst)).filter((n) => !usedFirst.has(n.toLowerCase()));
    const females = shuffle(uniq(cohort.femaleFirst)).filter(
      (n) => !usedFirst.has(n.toLowerCase()),
    );
    const lasts = shuffle(uniq(cohort.lasts)).filter((n) => !usedLast.has(n.toLowerCase()));

    const slots: Array<{ gender: 'male' | 'female'; first: string }> = [];
    const maxPairs = Math.min(males.length + females.length, lasts.length);
    let mi = 0;
    let fi = 0;
    for (let i = 0; i < maxPairs; i++) {
      const preferMale = i % 2 === 0;
      if (preferMale && mi < males.length) {
        slots.push({ gender: 'male', first: males[mi++]! });
      } else if (fi < females.length) {
        slots.push({ gender: 'female', first: females[fi++]! });
      } else if (mi < males.length) {
        slots.push({ gender: 'male', first: males[mi++]! });
      }
    }

    for (let i = 0; i < slots.length && i < lasts.length; i++) {
      const slot = slots[i]!;
      const last = lasts[i]!;
      const fk = slot.first.toLowerCase();
      const lk = last.toLowerCase();
      if (usedFirst.has(fk) || usedLast.has(lk)) continue;
      usedFirst.add(fk);
      usedLast.add(lk);
      pairs.push({
        gender: slot.gender,
        first_name: slot.first,
        last_name: last,
      });
    }
  }

  // Fallback: if we still need capacity later, allow cross-cohort leftovers
  const leftoverFirsts: Array<{ gender: 'male' | 'female'; first: string }> = [];
  const leftoverLasts: string[] = [];
  for (const cohort of COHORTS) {
    for (const n of uniq(cohort.maleFirst)) {
      if (!usedFirst.has(n.toLowerCase())) leftoverFirsts.push({ gender: 'male', first: n });
    }
    for (const n of uniq(cohort.femaleFirst)) {
      if (!usedFirst.has(n.toLowerCase())) leftoverFirsts.push({ gender: 'female', first: n });
    }
    for (const n of uniq(cohort.lasts)) {
      if (!usedLast.has(n.toLowerCase())) leftoverLasts.push(n);
    }
  }
  const lf = shuffle(leftoverFirsts);
  const ll = shuffle(leftoverLasts);
  for (let i = 0; i < Math.min(lf.length, ll.length); i++) {
    const first = lf[i]!;
    const last = ll[i]!;
    usedFirst.add(first.first.toLowerCase());
    usedLast.add(last.toLowerCase());
    pairs.push({
      gender: first.gender,
      first_name: first.first,
      last_name: last,
    });
  }

  return shuffle(pairs);
}

/**
 * Allocate `count` identities with unique first names and unique last names
 * when pool sizes allow. Mixes culture cohorts; pairs stay coherent when possible.
 */
export function allocateMailboxIdentities(count: number): MailboxIdentity[] {
  if (count <= 0) return [];

  const deck = buildCoherentPairDeck();
  const usedUser = new Set<string>();
  const out: MailboxIdentity[] = [];

  for (let i = 0; i < count; i++) {
    const pair = deck[i];
    if (pair) {
      out.push({
        ...pair,
        username: makeUsername(pair.first_name, pair.last_name, usedUser),
      });
      continue;
    }

    // Extreme overflow: recycle with numeric username suffixes only
    const wrap = deck[i % Math.max(deck.length, 1)];
    if (!wrap) {
      out.push({
        gender: i % 2 === 0 ? 'male' : 'female',
        first_name: 'Alex',
        last_name: `User${i + 1}`,
        username: makeUsername('Alex', `User${i + 1}`, usedUser),
      });
      continue;
    }
    out.push({
      ...wrap,
      username: makeUsername(wrap.first_name, wrap.last_name, usedUser),
    });
  }

  return out;
}

/** @deprecated Prefer allocateMailboxIdentities for batches. */
export function pickMailboxIdentity(seed?: number): MailboxIdentity {
  const [one] = allocateMailboxIdentities(1);
  if (one) return one;
  const gender: 'male' | 'female' = seed != null && seed % 2 === 0 ? 'male' : 'female';
  return {
    gender,
    first_name: gender === 'male' ? 'Alex' : 'Sam',
    last_name: 'Rivera',
    username: makeUsername(gender === 'male' ? 'Alex' : 'Sam', 'Rivera', new Set()),
  };
}
