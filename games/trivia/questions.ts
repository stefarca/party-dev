// A small, static, office-appropriate question bank (plan 07). Plain data,
// no imports — curating real content is PLAN.md §12 step 7's job, not this
// plan's; this is deliberately placeholder-quality.

export interface Question {
  id: string;
  q: string;
  choices: string[];
  answer: number; // index into `choices`
}

export const QUESTIONS: Question[] = [
  { id: "q01", q: "How many days are in a leap year?", choices: ["365", "366", "364", "367"], answer: 1 },
  { id: "q02", q: "What is the capital of Japan?", choices: ["Seoul", "Beijing", "Tokyo", "Bangkok"], answer: 2 },
  {
    id: "q03",
    q: "Which planet is known as the Red Planet?",
    choices: ["Venus", "Mars", "Jupiter", "Saturn"],
    answer: 1,
  },
  { id: "q04", q: "What is the boiling point of water at sea level, in Celsius?", choices: ["90", "100", "110", "212"], answer: 1 },
  { id: "q05", q: "Which language runs natively in a web browser?", choices: ["Python", "Java", "JavaScript", "C++"], answer: 2 },
  { id: "q06", q: "How many continents are there?", choices: ["5", "6", "7", "8"], answer: 2 },
  { id: "q07", q: "What does 'HTTP' stand for?", choices: [
    "HyperText Transfer Protocol",
    "High Transfer Text Process",
    "Hyperlink Text Transport Process",
    "Home Tool Transfer Protocol",
  ], answer: 0 },
  { id: "q08", q: "Which ocean is the largest by surface area?", choices: ["Atlantic", "Indian", "Arctic", "Pacific"], answer: 3 },
  { id: "q09", q: "What is the chemical symbol for gold?", choices: ["Go", "Gd", "Au", "Ag"], answer: 2 },
  { id: "q10", q: "In a standard week, how many working days are there?", choices: ["4", "5", "6", "7"], answer: 1 },
  { id: "q11", q: "Which of these is a version control system?", choices: ["Docker", "Git", "Redis", "Nginx"], answer: 1 },
  { id: "q12", q: "What is the smallest prime number?", choices: ["0", "1", "2", "3"], answer: 2 },
  { id: "q13", q: "Which company created the JavaScript runtime Node.js originally?", choices: [
    "Google",
    "Joyent",
    "Microsoft",
    "Facebook",
  ], answer: 1 },
  { id: "q14", q: "How many bits are in a byte?", choices: ["4", "8", "16", "32"], answer: 1 },
  { id: "q15", q: "Which of these fruits is technically a berry?", choices: ["Strawberry", "Banana", "Raspberry", "Apple"], answer: 1 },
  { id: "q16", q: "What year did the World Wide Web become publicly available?", choices: ["1989", "1991", "1995", "2000"], answer: 1 },
  { id: "q17", q: "Which shape has exactly six sides?", choices: ["Pentagon", "Hexagon", "Heptagon", "Octagon"], answer: 1 },
  { id: "q18", q: "What is the standard unit of electrical resistance?", choices: ["Volt", "Amp", "Ohm", "Watt"], answer: 2 },
  { id: "q19", q: "Which meal is traditionally eaten in the morning?", choices: ["Breakfast", "Lunch", "Dinner", "Brunch"], answer: 0 },
  { id: "q20", q: "How many minutes are in a full day?", choices: ["1200", "1440", "1000", "1600"], answer: 1 },
  { id: "q21", q: "Which of these is not a programming paradigm?", choices: [
    "Functional",
    "Object-oriented",
    "Alphabetical",
    "Procedural",
  ], answer: 2 },
  { id: "q22", q: "What does 'CSS' stand for?", choices: [
    "Computer Style Sheets",
    "Cascading Style Sheets",
    "Creative Style System",
    "Colorful Style Syntax",
  ], answer: 1 },
  { id: "q23", q: "Which of these is the odd one out?", choices: ["Circle", "Square", "Triangle", "Sphere"], answer: 3 },
  { id: "q24", q: "How many players are on a standard chess side?", choices: ["1", "2", "16", "8"], answer: 0 },
  { id: "q25", q: "What is the freezing point of water in Fahrenheit?", choices: ["0", "32", "100", "212"], answer: 1 },
];

export const QUESTION_COUNT = QUESTIONS.length;
