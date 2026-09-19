# OmniCampus 🎓
### Hyper-Localized College Learning & Micro-Gigs Ecosystem

OmniCampus is a specialized, modern learning platform designed specifically for college campuses. It bridges the gap between university syllabus requirements, peer-to-peer mentoring, coding interview preparation, and campus micro-task collaboration.

---

## 🌟 Key Features

### 1. Modern, Interactive Frontend (UI/UX)
- **Unified Academic Dashboard**: Real-time stats ribbon, semester course tracking, active peer mentors, and campus announcements.
- **Syllabus-Mapped Video Courses**: University semester-aligned curriculum with unit-by-unit syllabus breakdowns, video player modals, and lecture progress tracking.
- **Live Code Editor Sandbox & AI Explainer**:
  - Code editor with line numbers, code preset templates (Two Sum, Course Schedule Cycle Detection, LRU Cache, O(N²) Quadratic), and language selector (JavaScript, Python, C++, Java).
  - Built-in live sandbox execution console showing output logs, runtime in milliseconds, and memory stats.
  - **AI Code Explainer**: Automatic Big-O Time and Space complexity calculation, line-by-line algorithmic breakdown, edge-case vulnerability warnings, and interactive comprehension quizzes.
- **Coding Ranking Arena & Leaderboard**:
  - Live test runner validating student code against multiple test suites.
  - Awards Rank Points and Campus Coins upon accepted submissions.
  - Department, College Year/Batch, and Role filters with Grandmaster/Knight badges.
- **Campus Micro-Jobs Marketplace**:
  - Peer-to-peer gig board where students post tasks (Development, Tutoring, LaTeX lab reports, Design) with bounties in Campus Coins held in student escrow.
  - Interactive proposal application modal.
- **Role & Profile Switcher**:
  - One-click instant switching between pre-seeded personas:
    * **Alex Rivera** (Senior Mentor - CSE, 4th Year)
    * **Rohan Sharma** (Junior Student - CSE, 2nd Year)
    * **Priya Nair** (Junior Student - ECE, 1st Year)
    * **Dr. Harrison Vance** (College Admin & Dean of Computing)
    * **Elena Chen** (Senior Mentor - IT, 3rd Year)
  - Full registration form to add new campus members dynamically.

---

## 🏗️ Architecture & Project Structure

```
JARVIS/
├── backend/
│   ├── server.js              # Express app, middleware, static server & routing
│   ├── db.js                  # SQLite database, schema migration & sample seed data
│   ├── aiExplainer.js         # Intelligent code parsing, complexity & AST breakdown engine
│   └── routes/
│       ├── auth.js            # User authentication, profiles, role switching
│       ├── courses.js         # Course catalog, syllabus modules, enrollment, progress
│       ├── arena.js           # Coding challenges, automated test runner, leaderboard
│       ├── jobs.js            # Campus micro-jobs posting, browsing, and applying
│       └── ai.js              # AI code explanation and sandbox runner endpoints
├── public/
│   ├── index.html             # Single-page elevated responsive UI
│   ├── css/
│   │   └── styles.css         # Modern dark-mode cyber-campus design system
│   └── js/
│       ├── api.js             # Fetch API client wrapper for all REST endpoints
│       └── app.js             # State management, tab controller, modals, code runner
├── package.json
└── README.md
```

---

## 🔐 Role-Based Access Control (RBAC)

| Feature | Junior Student | Senior Mentor | College Admin |
| :--- | :---: | :---: | :---: |
| Browse & Enroll in Courses | ✅ | ✅ | ✅ |
| Track Syllabus Module Progress | ✅ | ✅ | ✅ |
| Publish New Syllabus Courses | ❌ | ✅ | ✅ |
| Run Code & Use AI Explainer | ✅ | ✅ | ✅ |
| Submit Arena Solutions | ✅ | ✅ | ✅ |
| Apply for Micro-Jobs | ✅ | ✅ | ✅ |
| Post Micro-Jobs (Escrow Coins) | ✅ | ✅ | ✅ |
| Manage User Directory | ❌ | ❌ | ✅ |

---

## 📡 REST API Reference

### 1. Authentication & Users
- `GET /api/auth/me` — Retrieve active session user profile with enrolled courses count, solved challenges, and coins balance.
- `GET /api/auth/users` — Directory of students, seniors, and faculty.
- `POST /api/auth/login` — Login via email or demo role.
- `POST /api/auth/register` — Register a new student/mentor account.

### 2. Syllabus Courses
- `GET /api/courses` — List courses. Query parameters: `?search=...&department=...&level=...`
- `GET /api/courses/:id` — Course detail with full unit syllabus and user progress.
- `POST /api/courses` — Publish a new course *(Authorized for Senior & Admin)*.
- `POST /api/courses/:id/enroll` — Enroll user into course.
- `POST /api/courses/:id/progress` — Mark module lecture completed and increment progress percentage.

### 3. AI Code Explainer & Sandbox
- `POST /api/ai/explain` — Performs algorithmic breakdown, Big-O complexity analysis, and generates retention quiz.
  - Body: `{ "code": "...", "language": "javascript|python", "mode": "full_analysis" }`
- `POST /api/ai/run` — Executes code snippet in a virtual runtime sandbox.
  - Body: `{ "code": "...", "language": "javascript|python" }`

### 4. Code Ranking Arena
- `GET /api/arena/challenges` — List coding arena challenges.
- `GET /api/arena/challenges/:id` — Get challenge specification and test cases.
- `POST /api/arena/submit` — Submit code solution, evaluate test cases, award rank points and campus coins.
- `GET /api/arena/leaderboard` — Get campus rankings with department, year batch, and role filters.

### 5. Campus Micro-Jobs
- `GET /api/jobs` — Browse micro-gigs. Query parameters: `?category=...&search=...&status=...`
- `POST /api/jobs` — Post a new gig with bounty in Campus Coins escrow.
- `POST /api/jobs/:id/apply` — Submit proposal and pitch for a micro-task.
- `PATCH /api/jobs/:id/status` — Update task status (`open`, `in_progress`, `completed`).

---

## 🚀 Setup & Running Instructions

### Prerequisites
- Node.js v18+ (tested on Node v22.22.3)
- npm v10+

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Start the OmniCampus Platform
```bash
npm start
# or
node backend/server.js
```

The server automatically initializes the SQLite database (`backend/omnicampus.db`) and seeds initial college courses, challenges, and peer profiles.

### Step 3: Open in Browser
Visit:
```
http://localhost:3000
```
*(In cloud/sandbox environments, bound to `http://0.0.0.0:3000`)*

---

## 🧪 Testing the Platform

1. **Test Role Switching**: Click on the user profile in the top-right navbar. Switch between **Alex Rivera (Senior Mentor)** and **Rohan Sharma (Junior Student)** to test permissions.
2. **Test Course Enrollment**: Go to the **Syllabus Courses** tab, click **"Syllabus"** on any course to open the lecture video player and unit breakdown, then click **"Mark Done"** to watch the progress bar update.
3. **Test AI Code Explainer**: Go to the **AI Explainer & Arena** tab, select a code preset or write your own, and click **"Explain with AI"**. View the Big-O meters, step-by-step breakdown, and take the comprehension quiz.
4. **Test Arena Submission**: Click **"Submit Solution"** in the Arena panel to see test cases run, points awarded, and live rank updates.
5. **Test Micro-Jobs**: Go to **Micro-Jobs**, click **"Apply"** on a gig to send a proposal, or click **"Post Micro-Task"** to escrow bounty coins.
