const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = path.join(__dirname, 'omnicampus.db');
const db = new DatabaseSync(dbPath);

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('Junior', 'Senior', 'Admin')),
    department TEXT NOT NULL,
    year TEXT NOT NULL,
    avatar TEXT,
    bio TEXT,
    coins INTEGER DEFAULT 1000,
    points INTEGER DEFAULT 500,
    reputation INTEGER DEFAULT 95,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    department TEXT NOT NULL,
    semester TEXT NOT NULL,
    instructor_name TEXT NOT NULL,
    instructor_role TEXT NOT NULL,
    instructor_id INTEGER,
    description TEXT NOT NULL,
    thumbnail_url TEXT,
    video_url TEXT,
    duration TEXT,
    level TEXT DEFAULT 'Intermediate',
    rating REAL DEFAULT 4.8,
    enrolled_count INTEGER DEFAULT 0,
    syllabus_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS enrollments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    course_id INTEGER NOT NULL,
    progress INTEGER DEFAULT 0,
    completed_modules_json TEXT DEFAULT '[]',
    enrolled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, course_id)
  );

  CREATE TABLE IF NOT EXISTS challenges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    difficulty TEXT NOT NULL,
    points INTEGER NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    starter_code_python TEXT,
    starter_code_js TEXT,
    test_cases_json TEXT NOT NULL,
    submissions_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS arena_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    challenge_id INTEGER NOT NULL,
    language TEXT NOT NULL,
    code TEXT NOT NULL,
    status TEXT NOT NULL,
    runtime_ms INTEGER DEFAULT 45,
    score_awarded INTEGER DEFAULT 0,
    output_log TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS micro_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    bounty_coins INTEGER NOT NULL,
    posted_by_user_id INTEGER NOT NULL,
    posted_by_name TEXT NOT NULL,
    posted_by_role TEXT NOT NULL,
    deadline TEXT NOT NULL,
    status TEXT DEFAULT 'open',
    applications_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS job_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    applicant_user_id INTEGER NOT NULL,
    applicant_name TEXT NOT NULL,
    applicant_role TEXT NOT NULL,
    applicant_department TEXT NOT NULL,
    proposal TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Check if seeding is required
const userCountQuery = db.prepare('SELECT COUNT(*) as count FROM users');
const userCount = userCountQuery.get().count;

if (userCount === 0) {
  console.log('🌱 Seeding OmniCampus database with college ecosystem records...');

  // 1. Seed Users (Senior, Junior, Admin)
  const insertUser = db.prepare(`
    INSERT INTO users (name, email, role, department, year, avatar, bio, coins, points, reputation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertUser.run(
    'Alex Rivera',
    'alex.rivera@campus.edu',
    'Senior',
    'Computer Science & Engineering',
    '4th Year',
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    'Senior Mentor & System Architecture enthusiast. Teaching CS301 and organizing weekly coding sprints.',
    1650,
    1840,
    98
  );

  insertUser.run(
    'Rohan Sharma',
    'rohan.sharma@campus.edu',
    'Junior',
    'Computer Science & Engineering',
    '2nd Year',
    'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=150&auto=format&fit=crop&q=80',
    'Sophomore eager to master Data Structures and competitive programming. Looking for peer gigs.',
    850,
    920,
    92
  );

  insertUser.run(
    'Priya Nair',
    'priya.nair@campus.edu',
    'Junior',
    'Electronics & Communication',
    '1st Year',
    'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80',
    'Freshman passionate about Embedded Systems, IoT, and Python algorithms.',
    500,
    640,
    90
  );

  insertUser.run(
    'Elena Chen',
    'elena.chen@campus.edu',
    'Senior',
    'Information Technology',
    '3rd Year',
    'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=150&auto=format&fit=crop&q=80',
    'Full-Stack Developer, teaching Web Arch & Deep Learning. Campus Hackathon Grand Prize winner.',
    2100,
    2150,
    99
  );

  insertUser.run(
    'Dr. Harrison Vance',
    'h.vance@campus.edu',
    'Admin',
    'Dean of Computing & Academic Dean',
    'Faculty',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    'Academic Dean overseeing syllabus mapping, peer tutor rewards, and departmental accreditations.',
    5000,
    3500,
    100
  );

  insertUser.run(
    'Marcus Brody',
    'marcus.brody@campus.edu',
    'Senior',
    'Computer Science & Engineering',
    '4th Year',
    'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
    'Competitive programmer, top ranker in ACM-ICPC Regionals, offering advanced mentoring sessions.',
    2400,
    2780,
    99
  );

  // 2. Seed Courses with Syllabus
  const insertCourse = db.prepare(`
    INSERT INTO courses (
      code, title, department, semester, instructor_name, instructor_role, instructor_id,
      description, thumbnail_url, video_url, duration, level, rating, enrolled_count, syllabus_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertCourse.run(
    'CS-301',
    'Data Structures & Algorithm Design: Syllabus Masterclass',
    'Computer Science & Engineering',
    'Semester 3 / 4',
    'Alex Rivera',
    'Senior Peer Mentor',
    1,
    'Tailored exactly to our university semester curriculum. Covers advanced Trees, Graph traversals, Dynamic Programming, and past university exam question breakdowns.',
    'https://images.unsplash.com/photo-1516116211227-bbc13c74a367?w=600&auto=format&fit=crop&q=80',
    'https://www.youtube.com/embed/8hly31xKli0',
    '8 hours • 16 lectures',
    'Intermediate',
    4.9,
    142,
    JSON.stringify([
      {
        unit: 'Unit 1: Non-Linear Data Structures',
        lectures: [
          { id: 1, title: 'Binary Search Trees & AVL Balancing', duration: '28 min', videoId: '8hly31xKli0', notes: 'Exam questions 2023-2025 included.' },
          { id: 2, title: 'Red-Black Trees & B-Trees in DBMS', duration: '34 min', videoId: '8hly31xKli0', notes: 'Comparison table and disk page indexing.' }
        ]
      },
      {
        unit: 'Unit 2: Graph Theory & Algorithms',
        lectures: [
          { id: 3, title: 'BFS, DFS & Topological Sort (Kahn\'s Algorithm)', duration: '41 min', videoId: '8hly31xKli0', notes: 'Includes cycle detection proofs.' },
          { id: 4, title: 'Dijkstra & Floyd-Warshall Shortest Paths', duration: '38 min', videoId: '8hly31xKli0', notes: 'Step-by-step matrix derivation.' }
        ]
      },
      {
        unit: 'Unit 3: Dynamic Programming & Exam Walkthrough',
        lectures: [
          { id: 5, title: '0/1 Knapsack vs Unbounded Knapsack', duration: '32 min', videoId: '8hly31xKli0', notes: 'Memoization vs Tabulation space optimization.' },
          { id: 6, title: 'Midterm 2025 Past Paper Live Solve', duration: '55 min', videoId: '8hly31xKli0', notes: 'Full 100-mark paper solution guide.' }
        ]
      }
    ])
  );

  insertCourse.run(
    'CS-204',
    'Operating Systems & Kernel Architecture Essentials',
    'Computer Science & Engineering',
    'Semester 4',
    'Dr. Harrison Vance',
    'Dean of Computing',
    5,
    'Direct mapping to the official college syllabus. Multithreading, process synchronization (Semaphores, Mutex), Virtual Memory, and Linux system calls.',
    'https://images.unsplash.com/photo-1629654297299-c8506221ca97?w=600&auto=format&fit=crop&q=80',
    'https://www.youtube.com/embed/26QPDBe-NB8',
    '6.5 hours • 12 lectures',
    'Intermediate',
    4.8,
    118,
    JSON.stringify([
      {
        unit: 'Unit 1: Process Management & Scheduling',
        lectures: [
          { id: 1, title: 'Process States & Context Switching', duration: '25 min', videoId: '26QPDBe-NB8', notes: 'PCB and kernel space vs user space.' },
          { id: 2, title: 'CPU Scheduling Algorithms: Round Robin & SRTF', duration: '35 min', videoId: '26QPDBe-NB8', notes: 'Gantt chart calculations for midterms.' }
        ]
      },
      {
        unit: 'Unit 2: Concurrency & Deadlocks',
        lectures: [
          { id: 3, title: 'Dining Philosophers & Banker\'s Algorithm', duration: '42 min', videoId: '26QPDBe-NB8', notes: 'Deadlock avoidance mathematical proof.' },
          { id: 4, title: 'POSIX Pthreads in C - Practical Lab Walkthrough', duration: '30 min', videoId: '26QPDBe-NB8', notes: 'Lab Experiment #3 runnable source code.' }
        ]
      }
    ])
  );

  insertCourse.run(
    'AI-402',
    'Deep Learning & Vision Transformers for Campus Projects',
    'Information Technology',
    'Semester 6 / 7',
    'Elena Chen',
    'Senior Project Lead',
    4,
    'Learn PyTorch, ConvNets, attention mechanisms, and Transformer architectures. Designed to help juniors ship their final year capstone projects with high grades.',
    'https://images.unsplash.com/photo-1677442136019-21780efad99a?w=600&auto=format&fit=crop&q=80',
    'https://www.youtube.com/embed/aircAruvnKk',
    '10 hours • 20 lectures',
    'Advanced',
    4.9,
    195,
    JSON.stringify([
      {
        unit: 'Unit 1: Neural Networks Foundations',
        lectures: [
          { id: 1, title: 'Backpropagation & Gradient Descent Derivation', duration: '45 min', videoId: 'aircAruvnKk', notes: 'Calculus refresher and matrix chain rule.' },
          { id: 2, title: 'PyTorch Model Training Workflow from Scratch', duration: '40 min', videoId: 'aircAruvnKk', notes: 'Colab notebook with GPU acceleration.' }
        ]
      },
      {
        unit: 'Unit 2: Transformers & Hugging Face',
        lectures: [
          { id: 3, title: 'Self-Attention & Multi-Head Mechanism', duration: '50 min', videoId: 'aircAruvnKk', notes: 'Attention is All You Need paper breakdown.' },
          { id: 4, title: 'Fine-Tuning Llama 3 for Campus Knowledge Base', duration: '60 min', videoId: 'aircAruvnKk', notes: 'LoRA & QLoRA quantization practical.' }
        ]
      }
    ])
  );

  insertCourse.run(
    'EC-201',
    'Digital Electronics, Verilog & Microcontroller Lab',
    'Electronics & Communication',
    'Semester 3',
    'Priya Nair',
    'Junior Tech Fellow',
    3,
    'K-Maps, Combinational & Sequential Logic, Finite State Machines, and hands-on Verilog HDL simulation for laboratory viva exams.',
    'https://images.unsplash.com/photo-1518770660439-4636190af475?w=600&auto=format&fit=crop&q=80',
    'https://www.youtube.com/embed/95kv5BF2Z9E',
    '5 hours • 10 lectures',
    'Beginner',
    4.7,
    89,
    JSON.stringify([
      {
        unit: 'Unit 1: Boolean Algebra & Minimization',
        lectures: [
          { id: 1, title: 'Karnaugh Maps 4-variable simplification', duration: '26 min', videoId: '95kv5BF2Z9E', notes: 'Don\'t care conditions and SOP forms.' },
          { id: 2, title: 'Multiplexers, Decoders & ALU Design', duration: '33 min', videoId: '95kv5BF2Z9E', notes: 'Standard IC pinouts and circuit diagrams.' }
        ]
      }
    ])
  );

  // 3. Seed Coding Arena Challenges
  const insertChallenge = db.prepare(`
    INSERT INTO challenges (
      title, slug, difficulty, points, category, description,
      starter_code_python, starter_code_js, test_cases_json, submissions_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertChallenge.run(
    'Two Sum: Campus Course Credits Matcher',
    'two-sum-credits',
    'Easy',
    100,
    'Hash Tables',
    'Given an array of integer credit values `credits` and an integer `target`, return indices of the two courses such that they add up to `target`. Each input has exactly one solution and you may not use the same element twice.\n\nExample:\nInput: credits = [2, 7, 11, 15], target = 9\nOutput: [0, 1] because credits[0] + credits[1] == 9.',
    `def two_sum(credits, target):
    # Write your solution here
    lookup = {}
    for i, num in enumerate(credits):
        complement = target - num
        if complement in lookup:
            return [lookup[complement], i]
        lookup[num] = i
    return []
`,
    `function twoSum(credits, target) {
  // Write your solution here
  const map = new Map();
  for (let i = 0; i < credits.length; i++) {
    const complement = target - credits[i];
    if (map.has(complement)) {
      return [map.get(complement), i];
    }
    map.set(credits[i], i);
  }
  return [];
}`,
    JSON.stringify([
      { input: { credits: [2, 7, 11, 15], target: 9 }, expected: [0, 1] },
      { input: { credits: [3, 2, 4], target: 6 }, expected: [1, 2] },
      { input: { credits: [3, 3], target: 6 }, expected: [0, 1] }
    ]),
    214
  );

  insertChallenge.run(
    'Campus Course Schedule: Cycle Detection in Prerequisites',
    'course-schedule-cycle',
    'Medium',
    250,
    'Graphs / Topological Sort',
    'There are a total of `numCourses` you have to take, labeled from 0 to numCourses - 1. You are given an array `prerequisites` where prerequisites[i] = [a, b] indicates you must take course b first if you want to take course a. Return true if it is possible to finish all courses (no cyclic dependency), or false otherwise.',
    `def can_finish(num_courses, prerequisites):
    from collections import defaultdict, deque
    adj = defaultdict(list)
    indegree = [0] * num_courses
    for dest, src in prerequisites:
        adj[src].append(dest)
        indegree[dest] += 1
    queue = deque([i for i in range(num_courses) if indegree[i] == 0])
    count = 0
    while queue:
        node = queue.popleft()
        count += 1
        for neighbor in adj[node]:
            indegree[neighbor] -= 1
            if indegree[neighbor] == 0:
                queue.append(neighbor)
    return count == num_courses
`,
    `function canFinish(numCourses, prerequisites) {
  const inDegree = new Array(numCourses).fill(0);
  const adj = Array.from({ length: numCourses }, () => []);
  
  for (const [dest, src] of prerequisites) {
    adj[src].push(dest);
    inDegree[dest]++;
  }
  
  const queue = [];
  for (let i = 0; i < numCourses; i++) {
    if (inDegree[i] === 0) queue.push(i);
  }
  
  let visited = 0;
  while (queue.length > 0) {
    const node = queue.shift();
    visited++;
    for (const neighbor of adj[node]) {
      inDegree[neighbor]--;
      if (inDegree[neighbor] === 0) {
        queue.push(neighbor);
      }
    }
  }
  return visited === numCourses;
}`,
    JSON.stringify([
      { input: { numCourses: 2, prerequisites: [[1, 0]] }, expected: true },
      { input: { numCourses: 2, prerequisites: [[1, 0], [0, 1]] }, expected: false },
      { input: { numCourses: 4, prerequisites: [[1, 0], [2, 0], [3, 1], [3, 2]] }, expected: true }
    ]),
    156
  );

  insertChallenge.run(
    'Campus High-Performance LRU Cache',
    'lru-cache-campus',
    'Hard',
    350,
    'Data Structures',
    'Design a data structure that follows the constraints of a Least Recently Used (LRU) cache. Implement LRUCache class with get(key) and put(key, value) in O(1) average time complexity.',
    `class LRUCache:
    def __init__(self, capacity: int):
        from collections import OrderedDict
        self.capacity = capacity
        self.cache = OrderedDict()

    def get(self, key: int) -> int:
        if key not in self.cache:
            return -1
        self.cache.move_to_end(key)
        return self.cache[key]

    def put(self, key: int, value: int) -> None:
        if key in self.cache:
            self.cache.move_to_end(key)
        self.cache[key] = value
        if len(self.cache) > self.capacity:
            self.cache.popitem(last=False)
`,
    `class LRUCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.cache = new Map();
  }
  get(key) {
    if (!this.cache.has(key)) return -1;
    const val = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, val);
    return val;
  }
  put(key, value) {
    if (this.cache.has(key)) this.cache.delete(key);
    this.cache.set(key, value);
    if (this.cache.size > this.capacity) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
  }
}`,
    JSON.stringify([
      { input: { operations: ["put","put","get","put","get"], values: [[1,1],[2,2],[1],[3,3],[2]] }, expected: [null,null,1,null,-1] }
    ]),
    98
  );

  // 4. Seed Campus Micro-Jobs
  const insertJob = db.prepare(`
    INSERT INTO micro_jobs (
      title, category, description, bounty_coins, posted_by_user_id,
      posted_by_name, posted_by_role, deadline, status, applications_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertJob.run(
    'Interactive 3D Rover Model Viewer for Robotics Club',
    'Development',
    'We need a Three.js / WebGL widget to embed on our student club site. Should load a GLTF model and let users rotate, zoom, and inspect subsystem callouts.',
    650,
    1,
    'Alex Rivera',
    'Senior',
    'In 4 days',
    'open',
    3
  );

  insertJob.run(
    'Peer Tutor: Differential Equations & Fourier Transforms',
    'Tutoring',
    'Looking for a 3rd or 4th year student to conduct two 90-minute doubt-clearing sessions for 5 juniors ahead of next Monday’s midterm.',
    450,
    2,
    'Rohan Sharma',
    'Junior',
    'In 2 days',
    'open',
    5
  );

  insertJob.run(
    'LaTeX Formatting & TikZ Diagrams for IEEE Conference Paper',
    'Research',
    'Need help converting a Word manuscript to an IEEE double-column LaTeX format with clean vector circuit diagrams.',
    500,
    4,
    'Elena Chen',
    'Senior',
    'In 5 days',
    'open',
    2
  );

  insertJob.run(
    'Design Hackathon Badge Icons & Figma Social Assets',
    'Design',
    'Need a set of 8 vector participant badges (e.g., Best UI, AI Wizard, Hardware Hacker) for the annual OmniHack campus hackathon.',
    350,
    1,
    'Alex Rivera',
    'Senior',
    'Tomorrow',
    'open',
    4
  );

  insertJob.run(
    'Python Script for Physics Lab Pendulum Motion Video Tracking',
    'Development',
    'Write an OpenCV script to track a neon marker on an oscillating pendulum and export (time, angle) coordinates to CSV for lab analysis.',
    400,
    3,
    'Priya Nair',
    'Junior',
    'In 3 days',
    'in_progress',
    6
  );

  // Seed sample initial enrollment
  const insertEnrollment = db.prepare(`
    INSERT INTO enrollments (user_id, course_id, progress, completed_modules_json)
    VALUES (?, ?, ?, ?)
  `);
  insertEnrollment.run(2, 1, 40, JSON.stringify([1, 2]));
  insertEnrollment.run(2, 2, 20, JSON.stringify([1]));
  insertEnrollment.run(3, 4, 60, JSON.stringify([1]));

  console.log('✅ OmniCampus database seeded successfully!');
}

module.exports = db;
