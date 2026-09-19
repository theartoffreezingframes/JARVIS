/**
 * OmniCampus Frontend Interactive Application
 * Powers tabs, modals, search/filtering, code editor sandbox,
 * AI Explainer visualizations, and micro-jobs marketplace.
 */

const App = {
  state: {
    currentUser: null,
    courses: [],
    challenges: [],
    currentChallengeId: null,
    jobs: [],
    leaderboard: [],
    activeTab: 'dashboard',
    editorLanguage: 'javascript'
  },

  // Code presets for the interactive editor
  codePresets: {
    twoSum: {
      javascript: `// Two Sum: Campus Course Credits Matcher
function twoSum(credits, target) {
  const map = new Map();
  for (let i = 0; i < credits.length; i++) {
    const complement = target - credits[i];
    if (map.has(complement)) {
      return [map.get(complement), i];
    }
    map.set(credits[i], i);
  }
  return [];
}

// Test Run
const credits = [2, 7, 11, 15];
const target = 9;
const result = twoSum(credits, target);
console.log('Result indices:', result);`,
      python: `# Two Sum: Campus Course Credits Matcher
def two_sum(credits, target):
    lookup = {}
    for i, num in enumerate(credits):
        complement = target - num
        if complement in lookup:
            return [lookup[complement], i]
        lookup[num] = i
    return []

credits = [2, 7, 11, 15]
target = 9
print("Result indices:", two_sum(credits, target))`
    },
    courseSchedule: {
      javascript: `// Campus Course Schedule: Cycle Detection in Prerequisites (Kahn's Algo)
function canFinish(numCourses, prerequisites) {
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
}

console.log('Can finish curriculum:', canFinish(4, [[1, 0], [2, 0], [3, 1], [3, 2]]));`,
      python: `def can_finish(num_courses, prerequisites):
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

print("Can finish:", can_finish(2, [[1, 0]]))`
    },
    lruCache: {
      javascript: `// Campus High-Performance LRU Cache
class LRUCache {
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
}

const lru = new LRUCache(2);
lru.put(1, 100);
lru.put(2, 200);
console.log('Get 1:', lru.get(1));
lru.put(3, 300); // evicts key 2
console.log('Get 2 (should be -1):', lru.get(2));`,
      python: `class LRUCache:
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
            self.cache.popitem(last=False)`
    },
    quadratic: {
      javascript: `// Quadratic Search O(N^2)
function hasDuplicates(list) {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (list[i] === list[j]) return true;
    }
  }
  return false;
}

console.log('Has duplicates:', hasDuplicates([1, 4, 7, 2, 9, 4]));`,
      python: `def has_duplicates(lst):
    for i in range(len(lst)):
        for j in range(i + 1, len(lst)):
            if lst[i] == lst[j]:
                return True
    return False`
    },
    custom: {
      javascript: `// Write your custom algorithm or data structure here
function solve() {
  console.log("OmniCampus Code Sandbox ready.");
}

solve();`,
      python: `# Write your custom Python algorithm here
def solve():
    print("OmniCampus Code Sandbox ready.")

solve()`
    }
  },

  // Initialize Application
  async init() {
    console.log('🚀 Initializing OmniCampus Platform...');
    this.bindEvents();

    try {
      await this.loadCurrentUser();
      await Promise.all([
        this.loadCourses(),
        this.loadChallenges(),
        this.loadJobs(),
        this.loadLeaderboard()
      ]);

      // Set initial code template
      this.applyCodePreset('twoSum');
      this.updateEditorLineNumbers();
    } catch (err) {
      console.error('Initialization error:', err);
      this.showToast('Failed to initialize campus data', 'error');
    }
  },

  // Bind UI Event Listeners
  bindEvents() {
    // Nav tabs
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = btn.dataset.tab;
        if (tab) this.switchTab(tab);
      });
    });

    // Profile switcher button
    const profileBtn = document.getElementById('profileSwitcherBtn');
    if (profileBtn) {
      profileBtn.addEventListener('click', () => this.openRoleModal());
    }

    // Modal Close on backdrop click & ESC key
    document.querySelectorAll('.modal-backdrop').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.remove('active');
        }
      });
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-backdrop.active').forEach(m => m.classList.remove('active'));
      }
    });

    // Course filters
    const courseSearch = document.getElementById('courseSearchInput');
    const courseDept = document.getElementById('courseDeptFilter');
    const courseLevel = document.getElementById('courseLevelFilter');
    if (courseSearch) courseSearch.addEventListener('input', () => this.loadCourses());
    if (courseDept) courseDept.addEventListener('change', () => this.loadCourses());
    if (courseLevel) courseLevel.addEventListener('change', () => this.loadCourses());

    // Create course button & form
    const btnOpenCreate = document.getElementById('btnOpenCreateCourseModal');
    if (btnOpenCreate) {
      btnOpenCreate.addEventListener('click', () => {
        if (this.state.currentUser && this.state.currentUser.role === 'Junior') {
          this.showToast('Note: Publishing syllabus courses is reserved for Seniors and Admins. Switch role in top-right to test publishing!', 'info');
          this.openRoleModal();
          return;
        }
        this.openModal('createCourseModal');
      });
    }

    const createCourseForm = document.getElementById('createCourseForm');
    if (createCourseForm) {
      createCourseForm.addEventListener('submit', (e) => this.handleCreateCourse(e));
    }

    // Micro-Jobs filters & form
    const jobSearch = document.getElementById('jobSearchInput');
    const jobCat = document.getElementById('jobCategoryFilter');
    const jobStatus = document.getElementById('jobStatusFilter');
    if (jobSearch) jobSearch.addEventListener('input', () => this.loadJobs());
    if (jobCat) jobCat.addEventListener('change', () => this.loadJobs());
    if (jobStatus) jobStatus.addEventListener('change', () => this.loadJobs());

    const btnOpenPostJob = document.getElementById('btnOpenPostJobModal');
    if (btnOpenPostJob) {
      btnOpenPostJob.addEventListener('click', () => this.openModal('postJobModal'));
    }

    const postJobForm = document.getElementById('postJobForm');
    if (postJobForm) {
      postJobForm.addEventListener('submit', (e) => this.handlePostJob(e));
    }

    const applyJobForm = document.getElementById('applyJobForm');
    if (applyJobForm) {
      applyJobForm.addEventListener('submit', (e) => this.handleApplyJob(e));
    }

    // Leaderboard filters
    const lbSearch = document.getElementById('leaderboardSearchInput');
    const lbDept = document.getElementById('leaderboardDeptFilter');
    const lbYear = document.getElementById('leaderboardYearFilter');
    const lbRole = document.getElementById('leaderboardRoleFilter');
    if (lbSearch) lbSearch.addEventListener('input', () => this.loadLeaderboard());
    if (lbDept) lbDept.addEventListener('change', () => this.loadLeaderboard());
    if (lbYear) lbYear.addEventListener('change', () => this.loadLeaderboard());
    if (lbRole) lbRole.addEventListener('change', () => this.loadLeaderboard());

    // Code Editor controls
    const editor = document.getElementById('codeEditorInput');
    if (editor) {
      editor.addEventListener('input', () => this.updateEditorLineNumbers());
      editor.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          const start = editor.selectionStart;
          const end = editor.selectionEnd;
          editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(end);
          editor.selectionStart = editor.selectionEnd = start + 2;
          this.updateEditorLineNumbers();
        }
      });
    }

    const templateSelect = document.getElementById('codeTemplateSelect');
    if (templateSelect) {
      templateSelect.addEventListener('change', (e) => {
        this.applyCodePreset(e.target.value);
      });
    }

    const langSelect = document.getElementById('codeLanguageSelect');
    if (langSelect) {
      langSelect.addEventListener('change', (e) => {
        this.state.editorLanguage = e.target.value;
        const currentPreset = document.getElementById('codeTemplateSelect').value;
        this.applyCodePreset(currentPreset);
      });
    }

    const btnCopy = document.getElementById('btnCopyCode');
    if (btnCopy) {
      btnCopy.addEventListener('click', () => {
        const code = document.getElementById('codeEditorInput').value;
        navigator.clipboard.writeText(code).then(() => {
          this.showToast('Code copied to clipboard!', 'info');
        });
      });
    }

    const btnReset = document.getElementById('btnResetCode');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        const currentPreset = document.getElementById('codeTemplateSelect').value;
        this.applyCodePreset(currentPreset);
        this.showToast('Snippet reset to initial template', 'info');
      });
    }

    const btnRun = document.getElementById('btnRunCode');
    if (btnRun) {
      btnRun.addEventListener('click', () => this.handleRunCode());
    }

    const btnExplain = document.getElementById('btnExplainCode');
    if (btnExplain) {
      btnExplain.addEventListener('click', () => this.handleExplainCode());
    }

    const btnSubmit = document.getElementById('btnSubmitChallenge');
    if (btnSubmit) {
      btnSubmit.addEventListener('click', () => this.handleSubmitChallenge());
    }

    const challengeSelect = document.getElementById('challengeSelector');
    if (challengeSelect) {
      challengeSelect.addEventListener('change', (e) => {
        const id = parseInt(e.target.value, 10);
        this.selectChallenge(id);
      });
    }

    // Register User Form
    const registerForm = document.getElementById('registerUserForm');
    if (registerForm) {
      registerForm.addEventListener('submit', (e) => this.handleRegisterUser(e));
    }
  },

  // Switch Active Tab
  switchTab(tabName) {
    this.state.activeTab = tabName;

    // Update Nav buttons
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update panes
    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.toggle('active', pane.id === `tab-${tabName}`);
    });

    // Scroll to top smoothly
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  // Modal helpers
  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('active');
  },

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
  },

  // Toast System
  showToast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const iconMap = {
      success: 'fa-solid fa-circle-check',
      error: 'fa-solid fa-circle-exclamation',
      info: 'fa-solid fa-circle-info'
    };

    toast.innerHTML = `
      <i class="${iconMap[type] || iconMap.info}"></i>
      <div style="flex: 1;">${message}</div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('hiding');
      setTimeout(() => toast.remove(), 250);
    }, duration);
  },

  // 1. Current User Management
  async loadCurrentUser() {
    try {
      const user = await Api.getCurrentUser();
      this.state.currentUser = user;
      this.renderUserUI(user);
    } catch (err) {
      console.error('Failed to load user:', err);
    }
  },

  renderUserUI(user) {
    if (!user) return;

    const nameEl = document.getElementById('currentUserName');
    const avatarEl = document.getElementById('currentUserAvatar');
    const roleBadge = document.getElementById('currentUserRoleBadge');
    const walletEl = document.getElementById('userCoinsCount');
    const ribbonRole = document.getElementById('ribbonRoleLabel');

    if (nameEl) nameEl.textContent = user.name;
    if (avatarEl && user.avatar) avatarEl.src = user.avatar;
    if (walletEl) walletEl.textContent = user.coins.toLocaleString();

    if (roleBadge) {
      roleBadge.textContent = `${user.role} Member`;
      roleBadge.className = `profile-role-badge role-${user.role.toLowerCase()}`;
    }

    if (ribbonRole) {
      ribbonRole.textContent = `${user.role} (${user.department})`;
      ribbonRole.className = `role-${user.role.toLowerCase()}`;
    }

    // Dashboard Hero greeting
    const welcomeTitle = document.getElementById('dashboardWelcomeTitle');
    if (welcomeTitle) {
      if (user.role === 'Senior') {
        welcomeTitle.textContent = `Welcome back, Senior Mentor ${user.name.split(' ')[0]}!`;
      } else if (user.role === 'Admin') {
        welcomeTitle.textContent = `Welcome, Dean ${user.name.split(' ')[0]} — College Admin Console`;
      } else {
        welcomeTitle.textContent = `Keep excelling, ${user.name.split(' ')[0]} — Fall 2026 Term`;
      }
    }

    // Dashboard Stats
    const statCoins = document.getElementById('statCoinsCount');
    const statRank = document.getElementById('statRank');
    const statEnrolled = document.getElementById('statEnrolledCount');
    const statSolved = document.getElementById('statSolvedCount');

    if (statCoins) statCoins.textContent = user.coins.toLocaleString();
    if (statRank) statRank.textContent = user.points > 2000 ? '#1' : user.points > 1500 ? '#3' : '#6';
    if (statEnrolled && user.stats) statEnrolled.textContent = user.stats.enrolledCourses || 2;
    if (statSolved && user.stats) statSolved.textContent = user.stats.solvedChallenges || 4;
  },

  // 2. Courses Module
  async loadCourses() {
    try {
      const search = document.getElementById('courseSearchInput')?.value || '';
      const department = document.getElementById('courseDeptFilter')?.value || 'all';
      const level = document.getElementById('courseLevelFilter')?.value || 'all';

      const courses = await Api.getCourses({ search, department, level });
      this.state.courses = courses;
      this.renderCourses(courses);
    } catch (err) {
      console.error('Error loading courses:', err);
    }
  },

  renderCourses(courses) {
    const container = document.getElementById('coursesGridContainer');
    if (!container) return;

    if (!courses || courses.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: var(--bg-card); border-radius: var(--radius-lg); border: 1px dashed var(--border-medium);">
          <i class="fa-solid fa-folder-open" style="font-size: 2.5rem; color: var(--text-dim); margin-bottom: 0.75rem;"></i>
          <h3 style="color: #fff; font-size: 1.1rem;">No courses found</h3>
          <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: 0.25rem;">Try adjusting your search query or department filter.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = courses.map(c => {
      const progress = c.userProgress || 0;
      const isEnrolled = c.isEnrolled;

      return `
        <div class="course-card">
          <div class="course-thumb-wrap">
            <img src="${c.thumbnail_url || 'https://images.unsplash.com/photo-1516116211227-bbc13c74a367?w=600&auto=format&fit=crop&q=80'}" alt="${c.title}" class="course-thumb">
            <span class="course-code-badge">${c.code}</span>
            <span class="course-level-badge">${c.level}</span>
          </div>

          <div class="course-body">
            <div class="course-meta">
              <span><i class="fa-regular fa-clock"></i> ${c.duration}</span>
              <span><i class="fa-solid fa-star" style="color: #fbbf24;"></i> ${c.rating} (${c.enrolled_count} students)</span>
            </div>

            <h3 class="course-title">${c.title}</h3>
            <p class="course-desc">${c.description}</p>

            <div class="course-instructor">
              <i class="fa-solid fa-chalkboard-user"></i>
              <span>${c.instructor_name} (${c.instructor_role})</span>
            </div>

            <div class="progress-container">
              <div class="progress-header">
                <span>Semester Mapping: <strong>${c.semester}</strong></span>
                <span>${progress}% Complete</span>
              </div>
              <div class="progress-bar-bg">
                <div class="progress-bar-fill" style="width: ${progress}%;"></div>
              </div>
            </div>

            <div class="course-footer">
              <span class="lecture-count"><i class="fa-solid fa-layer-group"></i> ${c.totalLectures || 8} Modules</span>
              <div style="display: flex; gap: 0.5rem;">
                <button class="btn btn-sm btn-secondary" onclick="App.viewCourseDetails(${c.id})">
                  <i class="fa-solid fa-list-check"></i> Syllabus
                </button>
                <button class="btn btn-sm ${isEnrolled ? 'btn-success' : 'btn-primary'}" onclick="App.handleEnrollCourse(${c.id})">
                  <i class="fa-solid ${isEnrolled ? 'fa-play' : 'fa-plus'}"></i>
                  ${isEnrolled ? 'Continue' : 'Enroll'}
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  async viewCourseDetails(courseId) {
    try {
      const course = await Api.getCourseById(courseId);
      const modalTitle = document.getElementById('courseModalTitle');
      const modalBody = document.getElementById('courseModalBody');

      if (modalTitle) {
        modalTitle.innerHTML = `
          <i class="fa-solid fa-graduation-cap" style="color: var(--primary);"></i>
          <span>${course.code}: ${course.title}</span>
        `;
      }

      const completed = new Set(course.completedModules || []);

      let syllabusHtml = course.syllabus.map((unit, uIdx) => {
        const lecturesHtml = (unit.lectures || []).map(lec => {
          const isDone = completed.has(lec.id);
          return `
            <div class="lecture-row">
              <div class="lecture-left">
                <i class="fa-solid ${isDone ? 'fa-circle-check' : 'fa-circle-play'}" style="color: ${isDone ? 'var(--accent-emerald)' : 'var(--primary)'}; font-size: 1.1rem;"></i>
                <div>
                  <strong>${lec.title}</strong>
                  <div style="font-size: 0.75rem; color: var(--text-dim);">${lec.duration} • ${lec.notes || 'Lab code and lecture notes included.'}</div>
                </div>
              </div>
              <button class="btn btn-sm ${isDone ? 'btn-secondary' : 'btn-primary'}" onclick="App.markModuleDone(${course.id}, ${lec.id})">
                ${isDone ? '✓ Completed' : 'Mark Done'}
              </button>
            </div>
          `;
        }).join('');

        return `
          <div class="syllabus-unit">
            <div class="syllabus-unit-title">${unit.unit}</div>
            <div>${lecturesHtml}</div>
          </div>
        `;
      }).join('');

      modalBody.innerHTML = `
        <div style="margin-bottom: 1.25rem;">
          <div style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; border-radius: var(--radius-md); background: #000; margin-bottom: 1rem; border: 1px solid var(--border-subtle);">
            <iframe src="${course.video_url || 'https://www.youtube.com/embed/8hly31xKli0'}"
              style="position: absolute; top:0; left: 0; width: 100%; height: 100%; border:0;"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowfullscreen>
            </iframe>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem;">
            <div>
              <span class="course-code-badge" style="position: static; display: inline-block; margin-right: 0.5rem;">${course.code}</span>
              <span style="font-size: 0.85rem; color: var(--text-muted);">${course.department} • ${course.semester}</span>
            </div>
            <div style="font-size: 0.85rem; color: var(--accent-emerald);">
              <strong>${course.userProgress || 0}% Progress</strong>
            </div>
          </div>

          <p style="font-size: 0.875rem; color: var(--text-muted); line-height: 1.6; margin-bottom: 1.25rem;">
            ${course.description}
          </p>

          <h4 style="font-size: 0.95rem; font-weight: 700; color: #fff; margin-bottom: 0.75rem;">
            <i class="fa-solid fa-list-check" style="color: var(--primary);"></i> University Syllabus Unit Modules
          </h4>
          ${syllabusHtml}
        </div>
      `;

      this.openModal('courseDetailModal');
    } catch (err) {
      this.showToast('Failed to load course details', 'error');
    }
  },

  async handleEnrollCourse(courseId) {
    try {
      const res = await Api.enrollInCourse(courseId);
      this.showToast(res.message, 'success');
      await this.loadCourses();
      await this.loadCurrentUser();
    } catch (err) {
      this.showToast(err.message || 'Enrollment failed', 'error');
    }
  },

  async markModuleDone(courseId, lectureId) {
    try {
      const res = await Api.updateCourseProgress(courseId, lectureId);
      this.showToast(`Module marked complete! Progress: ${res.progress}%`, 'success');
      this.viewCourseDetails(courseId);
      this.loadCourses();
    } catch (err) {
      this.showToast('Failed to update progress', 'error');
    }
  },

  async handleCreateCourse(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);

    const payload = {
      code: formData.get('code'),
      title: formData.get('title'),
      department: formData.get('department'),
      semester: formData.get('semester'),
      level: formData.get('level'),
      description: formData.get('description'),
      video_url: formData.get('video_url') || 'https://www.youtube.com/embed/8hly31xKli0'
    };

    try {
      const res = await Api.createCourse(payload);
      this.showToast(res.message, 'success');
      this.closeModal('createCourseModal');
      form.reset();
      await this.loadCourses();
      await this.loadCurrentUser();
    } catch (err) {
      this.showToast(err.message || 'Course publication failed', 'error');
    }
  },

  // 3. AI Code Explainer & Code Arena
  async loadChallenges() {
    try {
      const challenges = await Api.getChallenges();
      this.state.challenges = challenges;

      const selector = document.getElementById('challengeSelector');
      if (selector && challenges.length > 0) {
        selector.innerHTML = challenges.map(c => `
          <option value="${c.id}">${c.title} (${c.points} pts - ${c.difficulty})</option>
        `).join('');

        this.selectChallenge(challenges[0].id);
      }
    } catch (err) {
      console.error('Failed to load challenges:', err);
    }
  },

  selectChallenge(challengeId) {
    this.state.currentChallengeId = challengeId;
    const challenge = this.state.challenges.find(c => c.id === challengeId);
    if (!challenge) return;

    if (challenge.slug === 'two-sum-credits') {
      this.applyCodePreset('twoSum');
      document.getElementById('codeTemplateSelect').value = 'twoSum';
    } else if (challenge.slug === 'course-schedule-cycle') {
      this.applyCodePreset('courseSchedule');
      document.getElementById('codeTemplateSelect').value = 'courseSchedule';
    } else if (challenge.slug === 'lru-cache-campus') {
      this.applyCodePreset('lruCache');
      document.getElementById('codeTemplateSelect').value = 'lruCache';
    }
  },

  applyCodePreset(presetKey) {
    const lang = this.state.editorLanguage || 'javascript';
    const preset = this.codePresets[presetKey] || this.codePresets.twoSum;
    const code = preset[lang] || preset.javascript || '';

    const editor = document.getElementById('codeEditorInput');
    if (editor) {
      editor.value = code;
      this.updateEditorLineNumbers();
    }
  },

  updateEditorLineNumbers() {
    const editor = document.getElementById('codeEditorInput');
    const gutter = document.getElementById('editorLineNumbers');
    if (!editor || !gutter) return;

    const lineCount = (editor.value.match(/\n/g) || []).length + 1;
    let numbers = [];
    for (let i = 1; i <= Math.max(lineCount, 12); i++) {
      numbers.push(i);
    }
    gutter.innerHTML = numbers.join('<br>');
  },

  async handleRunCode() {
    const editor = document.getElementById('codeEditorInput');
    const consoleOutput = document.getElementById('consoleOutput');
    const durationBadge = document.getElementById('runDurationBadge');
    if (!editor || !consoleOutput) return;

    const code = editor.value;
    const language = this.state.editorLanguage;

    consoleOutput.innerHTML = '<span style="color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Executing in sandboxed runtime...</span>';

    try {
      const res = await Api.runCode({ code, language });
      durationBadge.textContent = `⚡ Executed in ${res.duration}`;
      consoleOutput.innerHTML = `<span style="color: #38bdf8;">${this.escapeHtml(res.stdout)}</span>`;
      this.showToast('Sandbox code execution finished', 'info');
    } catch (err) {
      consoleOutput.innerHTML = `<span style="color: var(--accent-rose);">Error: ${this.escapeHtml(err.message)}</span>`;
    }
  },

  async handleExplainCode() {
    const editor = document.getElementById('codeEditorInput');
    const btnExplain = document.getElementById('btnExplainCode');
    const statusLabel = document.getElementById('analysisStatusLabel');
    if (!editor) return;

    const code = editor.value;
    const language = this.state.editorLanguage;

    if (btnExplain) {
      btnExplain.disabled = true;
      btnExplain.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing...';
    }
    if (statusLabel) statusLabel.textContent = 'Neural Parsing...';

    try {
      const analysis = await Api.explainCode({ code, language, mode: 'full_analysis' });
      this.renderAIAnalysis(analysis);
      this.showToast('AI Algorithmic Breakdown complete!', 'success');
      if (statusLabel) statusLabel.textContent = 'Analyzed Just Now';
    } catch (err) {
      this.showToast(err.message || 'AI explanation failed', 'error');
      if (statusLabel) statusLabel.textContent = 'Analysis Failed';
    } finally {
      if (btnExplain) {
        btnExplain.disabled = false;
        btnExplain.innerHTML = '<i class="fa-solid fa-brain"></i> Explain with AI';
      }
    }
  },

  renderAIAnalysis(analysis) {
    if (!analysis) return;

    const timeVal = document.getElementById('aiTimeValue');
    const timeDesc = document.getElementById('aiTimeDesc');
    const spaceVal = document.getElementById('aiSpaceValue');
    const spaceDesc = document.getElementById('aiSpaceDesc');
    const breakdownCont = document.getElementById('aiBreakdownContainer');
    const tipsCont = document.getElementById('aiTipsContainer');

    if (timeVal) timeVal.textContent = analysis.complexity.time;
    if (timeDesc) timeDesc.textContent = analysis.complexity.timeExplanation;
    if (spaceVal) spaceVal.textContent = analysis.complexity.space;
    if (spaceDesc) spaceDesc.textContent = analysis.complexity.spaceExplanation;

    if (breakdownCont && analysis.lineBreakdown) {
      breakdownCont.innerHTML = analysis.lineBreakdown.map(step => `
        <div class="breakdown-item">
          <span class="breakdown-line-tag">${step.lines}</span>
          <span class="breakdown-code">${this.escapeHtml(step.code)}</span>
          <p class="breakdown-desc">${step.purpose}</p>
        </div>
      `).join('');
    }

    if (tipsCont && analysis.optimizationTips) {
      tipsCont.innerHTML = [
        ...analysis.optimizationTips.map(t => `<li>${t}</li>`),
        ...(analysis.edgeCases || []).map(e => `<li><strong style="color: var(--accent-amber);">Edge check:</strong> ${e}</li>`)
      ].join('');
    }

    // Render Quiz
    if (analysis.quiz) {
      this.renderQuiz(analysis.quiz);
    }
  },

  renderQuiz(quiz) {
    const questionText = document.getElementById('quizQuestionText');
    const optionsCont = document.getElementById('quizOptionsContainer');
    const feedback = document.getElementById('quizFeedback');

    if (questionText) questionText.textContent = `💡 Comprehension Check: ${quiz.question}`;
    if (feedback) feedback.innerHTML = '';

    if (optionsCont && quiz.options) {
      optionsCont.innerHTML = quiz.options.map((opt, idx) => `
        <button class="quiz-option-btn" onclick="App.checkQuizAnswer(${idx}, ${quiz.correctAnswer}, '${encodeURIComponent(quiz.explanation)}')">
          ${String.fromCharCode(65 + idx)}. ${opt}
        </button>
      `).join('');
    }
  },

  checkQuizAnswer(selectedIndex, correctIndex, encodedExplanation) {
    const feedback = document.getElementById('quizFeedback');
    const options = document.querySelectorAll('.quiz-option-btn');
    const explanation = decodeURIComponent(encodedExplanation);

    options.forEach((btn, idx) => {
      btn.disabled = true;
      if (idx === correctIndex) {
        btn.classList.add('correct');
      } else if (idx === selectedIndex) {
        btn.classList.add('wrong');
      }
    });

    if (selectedIndex === correctIndex) {
      feedback.innerHTML = `<span style="color: var(--accent-emerald);"><i class="fa-solid fa-circle-check"></i> Spot on! ${explanation} (+15 Bonus Coins)</span>`;
      this.showToast('Correct! Great algorithmic intuition.', 'success');
    } else {
      feedback.innerHTML = `<span style="color: #fb7185;"><i class="fa-solid fa-circle-xmark"></i> Not quite. ${explanation}</span>`;
    }
  },

  async handleSubmitChallenge() {
    const editor = document.getElementById('codeEditorInput');
    const consoleOutput = document.getElementById('consoleOutput');
    const durationBadge = document.getElementById('runDurationBadge');
    if (!editor) return;

    const challengeId = this.state.currentChallengeId || 1;
    const code = editor.value;
    const language = this.state.editorLanguage;

    consoleOutput.innerHTML = '<span style="color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Submitting to OmniCampus Arena Evaluator...</span>';

    try {
      const result = await Api.submitChallenge(challengeId, code, language);

      if (result.status === 'Accepted') {
        durationBadge.textContent = `🏆 Accepted (${result.runtimeMs}ms)`;
        consoleOutput.innerHTML = `
          <div style="color: #34d399; font-weight: 700; margin-bottom: 0.5rem;">${result.message}</div>
          <div style="color: var(--text-muted); font-size: 0.775rem;">Memory: ${result.memoryUsed}</div>
          <div style="margin-top: 0.5rem;">
            ${(result.testResults || []).map(t => `
              <div style="color: #38bdf8; font-size: 0.775rem;">✔ Test Case ${t.case}: Input ${t.input} → Passed in ${t.runtime}</div>
            `).join('')}
          </div>
        `;
        this.showToast(`🎉 Challenge Accepted! +${result.pointsAwarded} Points!`, 'success');
        await this.loadCurrentUser();
        await this.loadLeaderboard();
      } else {
        durationBadge.textContent = '❌ Solution Incomplete';
        consoleOutput.innerHTML = `<span style="color: var(--accent-rose);">${result.message}</span>`;
        this.showToast(result.message, 'error');
      }
    } catch (err) {
      consoleOutput.innerHTML = `<span style="color: var(--accent-rose);">${err.message}</span>`;
      this.showToast('Submission error', 'error');
    }
  },

  // 4. Campus Micro-Jobs
  async loadJobs() {
    try {
      const search = document.getElementById('jobSearchInput')?.value || '';
      const category = document.getElementById('jobCategoryFilter')?.value || 'all';
      const status = document.getElementById('jobStatusFilter')?.value || 'all';

      const jobs = await Api.getJobs({ search, category, status });
      this.state.jobs = jobs;
      this.renderJobs(jobs);
    } catch (err) {
      console.error('Failed to load jobs:', err);
    }
  },

  renderJobs(jobs) {
    const container = document.getElementById('jobsGridContainer');
    if (!container) return;

    if (!jobs || jobs.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: var(--bg-card); border-radius: var(--radius-lg); border: 1px dashed var(--border-medium);">
          <i class="fa-solid fa-briefcase" style="font-size: 2.5rem; color: var(--text-dim); margin-bottom: 0.75rem;"></i>
          <h3 style="color: #fff; font-size: 1.1rem;">No micro-tasks found</h3>
          <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: 0.25rem;">Be the first to post a campus micro-task for your peers!</p>
        </div>
      `;
      return;
    }

    const catClassMap = {
      Development: 'cat-dev',
      Tutoring: 'cat-tutoring',
      Research: 'cat-research',
      Design: 'cat-design'
    };

    container.innerHTML = jobs.map(j => {
      const catClass = catClassMap[j.category] || 'cat-dev';

      return `
        <div class="job-card">
          <div class="job-header">
            <span class="job-category-tag ${catClass}">${j.category}</span>
            <div class="job-bounty">
              <i class="fa-solid fa-coins"></i> ${j.bounty_coins} Coins
            </div>
          </div>

          <h3 class="job-title">${j.title}</h3>
          <p class="job-desc">${j.description}</p>

          <div style="font-size: 0.775rem; color: var(--text-dim); margin-bottom: 1rem; display: flex; align-items: center; justify-content: space-between;">
            <span><i class="fa-regular fa-clock"></i> Deadline: <strong>${j.deadline}</strong></span>
            <span><i class="fa-solid fa-users"></i> ${j.applications_count} applicants</span>
          </div>

          <div class="job-footer">
            <div class="job-poster">
              <i class="fa-solid fa-user-circle" style="color: var(--primary); font-size: 1.1rem;"></i>
              <span>${j.posted_by_name} (${j.posted_by_role})</span>
            </div>

            <div>
              ${j.hasApplied
                ? `<span class="btn btn-sm btn-secondary" style="cursor: default; color: var(--accent-emerald);">✓ Applied</span>`
                : j.isOwner
                  ? `<span class="btn btn-sm btn-secondary" style="cursor: default;">Your Post</span>`
                  : `<button class="btn btn-sm btn-primary" onclick="App.openApplyJobModal(${j.id}, '${encodeURIComponent(j.title)}', ${j.bounty_coins})">
                      <i class="fa-solid fa-paper-plane"></i> Apply
                    </button>`
              }
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  openApplyJobModal(jobId, encodedTitle, bounty) {
    const title = decodeURIComponent(encodedTitle);
    document.getElementById('applyJobId').value = jobId;
    document.getElementById('applyJobTitle').textContent = title;
    document.getElementById('applyJobBounty').innerHTML = `<i class="fa-solid fa-coins"></i> ${bounty} Campus Coins in Escrow`;
    this.openModal('applyJobModal');
  },

  async handleApplyJob(e) {
    e.preventDefault();
    const form = e.target;
    const jobId = form.querySelector('#applyJobId').value;
    const proposal = form.querySelector('[name="proposal"]').value;

    try {
      const res = await Api.applyForJob(jobId, proposal);
      this.showToast(res.message, 'success');
      this.closeModal('applyJobModal');
      form.reset();
      await this.loadJobs();
    } catch (err) {
      this.showToast(err.message || 'Failed to submit proposal', 'error');
    }
  },

  async handlePostJob(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);

    const payload = {
      title: formData.get('title'),
      category: formData.get('category'),
      description: formData.get('description'),
      bounty_coins: parseInt(formData.get('bounty_coins'), 10),
      deadline: formData.get('deadline')
    };

    try {
      const res = await Api.createJob(payload);
      this.showToast(res.message, 'success');
      this.closeModal('postJobModal');
      form.reset();
      await this.loadJobs();
      await this.loadCurrentUser();
    } catch (err) {
      this.showToast(err.message || 'Failed to post task', 'error');
    }
  },

  // 5. Leaderboard Arena
  async loadLeaderboard() {
    try {
      const search = document.getElementById('leaderboardSearchInput')?.value || '';
      const department = document.getElementById('leaderboardDeptFilter')?.value || 'all';
      const year = document.getElementById('leaderboardYearFilter')?.value || 'all';
      const role = document.getElementById('leaderboardRoleFilter')?.value || 'all';

      const leaderboard = await Api.getLeaderboard({ department, year, role });

      let filtered = leaderboard;
      if (search && search.trim()) {
        const term = search.toLowerCase();
        filtered = leaderboard.filter(u => u.name.toLowerCase().includes(term) || u.department.toLowerCase().includes(term));
      }

      this.state.leaderboard = filtered;
      this.renderLeaderboard(filtered);
      this.renderPeerMentors(leaderboard.filter(u => u.role === 'Senior').slice(0, 4));
    } catch (err) {
      console.error('Failed to load leaderboard:', err);
    }
  },

  renderLeaderboard(leaders) {
    const tbody = document.getElementById('leaderboardTableBody');
    if (!tbody) return;

    if (!leaders || leaders.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-muted);">
            No ranking records matching current filters.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = leaders.map(u => {
      const rankBadgeClass = u.rank === 1 ? 'rank-1' : u.rank === 2 ? 'rank-2' : u.rank === 3 ? 'rank-3' : 'rank-other';
      const roleClass = `role-${u.role.toLowerCase()}`;

      return `
        <tr>
          <td style="text-align: center;">
            <span class="rank-badge ${rankBadgeClass}">${u.rank}</span>
          </td>
          <td>
            <div class="user-cell">
              <img src="${u.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80'}" alt="${u.name}" class="user-cell-avatar">
              <div class="user-cell-info">
                <strong>${u.name}</strong>
                <span>${u.badge || 'Scholar'}</span>
              </div>
            </div>
          </td>
          <td>
            <div style="font-weight: 600; color: #fff;">${u.department}</div>
            <div style="font-size: 0.75rem; color: var(--text-dim);">${u.year}</div>
          </td>
          <td>
            <span class="profile-role-badge ${roleClass}">${u.role}</span>
          </td>
          <td>
            <i class="fa-solid fa-code" style="color: var(--accent-cyan);"></i>
            <strong>${u.solvedCount || 0}</strong> solved
          </td>
          <td>
            <span style="color: #34d399; font-weight: 600;">${u.reputation}%</span>
          </td>
          <td>
            <span class="points-pill">${u.points.toLocaleString()} pts</span>
          </td>
        </tr>
      `;
    }).join('');
  },

  renderPeerMentors(mentors) {
    const container = document.getElementById('mentorsListContainer');
    if (!container) return;

    container.innerHTML = mentors.map(m => `
      <div class="mentor-card">
        <div class="mentor-profile">
          <img src="${m.avatar}" alt="${m.name}" class="mentor-avatar">
          <div>
            <div class="mentor-name">${m.name}</div>
            <div class="mentor-spec">${m.department.split('&')[0]} • ${m.points} pts</div>
          </div>
        </div>
        <button class="btn btn-sm btn-secondary" onclick="App.switchToUser(${m.id})">
          Switch
        </button>
      </div>
    `).join('');
  },

  // 6. Role & Demo User Switcher
  async openRoleModal() {
    try {
      const users = await Api.getAllUsers();
      const listCont = document.getElementById('demoUsersList');

      if (listCont) {
        listCont.innerHTML = users.map(u => {
          const isCurrent = this.state.currentUser && this.state.currentUser.id === u.id;
          return `
            <div class="mentor-card" style="border: 1px solid ${isCurrent ? 'var(--primary)' : 'var(--border-subtle)'}; background: ${isCurrent ? 'rgba(99, 102, 241, 0.1)' : 'rgba(255, 255, 255, 0.02)'};">
              <div class="mentor-profile">
                <img src="${u.avatar}" alt="${u.name}" class="mentor-avatar">
                <div>
                  <div class="mentor-name">${u.name} ${isCurrent ? '<span style="color: var(--accent-cyan); font-size: 0.75rem;">(Active)</span>' : ''}</div>
                  <div class="mentor-spec">${u.role} • ${u.department} • 🪙 ${u.coins} Coins</div>
                </div>
              </div>
              <button class="btn btn-sm ${isCurrent ? 'btn-success' : 'btn-primary'}" onclick="App.switchToUser(${u.id})">
                ${isCurrent ? 'Selected' : 'Use Persona'}
              </button>
            </div>
          `;
        }).join('');
      }

      this.openModal('roleModal');
    } catch (err) {
      this.showToast('Failed to load user directory', 'error');
    }
  },

  async switchToUser(userId) {
    try {
      Api.setUserId(userId);
      await this.loadCurrentUser();
      await Promise.all([
        this.loadCourses(),
        this.loadJobs(),
        this.loadLeaderboard()
      ]);
      this.closeModal('roleModal');
      this.showToast(`Switched active profile to ${this.state.currentUser.name} (${this.state.currentUser.role})!`, 'success');
    } catch (err) {
      this.showToast('Failed to switch user profile', 'error');
    }
  },

  async handleRegisterUser(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);

    const payload = {
      name: formData.get('name'),
      email: formData.get('email'),
      role: formData.get('role'),
      department: formData.get('department'),
      year: '1st Year'
    };

    try {
      const res = await Api.register(payload);
      Api.setUserId(res.user.id);
      this.showToast(res.message, 'success');
      this.closeModal('roleModal');
      form.reset();

      await this.loadCurrentUser();
      await this.loadLeaderboard();
    } catch (err) {
      this.showToast(err.message || 'Registration failed', 'error');
    }
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
};

// Launch when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});

window.App = App;
