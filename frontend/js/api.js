/**
 * OmniCampus API Client
 * Seamlessly interfaces with backend REST endpoints using Fetch API.
 */

const API_BASE = '/api';

const Api = {
  // Current active user ID (persisted in localStorage or defaulted to 1)
  getUserId() {
    return localStorage.getItem('omnicampus_user_id') || '1';
  },

  setUserId(id) {
    localStorage.setItem('omnicampus_user_id', String(id));
  },

  getHeaders() {
    return {
      'Content-Type': 'application/json',
      'x-user-id': this.getUserId()
    };
  },

  async request(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const headers = { ...this.getHeaders(), ...(options.headers || {}) };

    try {
      const response = await fetch(url, { ...options, headers });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || `HTTP error! status: ${response.status}`);
      }

      return data;
    } catch (err) {
      console.error(`API Error on [${options.method || 'GET'} ${endpoint}]:`, err);
      throw err;
    }
  },

  // Auth & User Endpoints
  async getCurrentUser() {
    return this.request('/auth/me');
  },

  async getAllUsers() {
    return this.request('/auth/users');
  },

  async login(credentials) {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials)
    });
  },

  async register(userData) {
    return this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData)
    });
  },

  // Course Management Endpoints
  async getCourses(filters = {}) {
    const params = new URLSearchParams();
    if (filters.department) params.append('department', filters.department);
    if (filters.search) params.append('search', filters.search);
    if (filters.level) params.append('level', filters.level);

    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/courses${query}`);
  },

  async getCourseById(id) {
    return this.request(`/courses/${id}`);
  },

  async createCourse(courseData) {
    return this.request('/courses', {
      method: 'POST',
      body: JSON.stringify(courseData)
    });
  },

  async enrollInCourse(courseId) {
    return this.request(`/courses/${courseId}/enroll`, {
      method: 'POST'
    });
  },

  async updateCourseProgress(courseId, lectureId, progress) {
    return this.request(`/courses/${courseId}/progress`, {
      method: 'POST',
      body: JSON.stringify({ lectureId, progress })
    });
  },

  // AI Code Explainer Endpoints
  async explainCode(payload) {
    return this.request('/ai/explain', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async runCode(payload) {
    return this.request('/ai/run', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  // Code Ranking Arena Endpoints
  async getChallenges() {
    return this.request('/arena/challenges');
  },

  async getChallengeById(id) {
    return this.request(`/arena/challenges/${id}`);
  },

  async submitChallenge(challengeId, code, language) {
    return this.request('/arena/submit', {
      method: 'POST',
      body: JSON.stringify({ challengeId, code, language })
    });
  },

  async getLeaderboard(filters = {}) {
    const params = new URLSearchParams();
    if (filters.department) params.append('department', filters.department);
    if (filters.year) params.append('year', filters.year);
    if (filters.role) params.append('role', filters.role);

    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/arena/leaderboard${query}`);
  },

  // Campus Micro-Jobs Endpoints
  async getJobs(filters = {}) {
    const params = new URLSearchParams();
    if (filters.category) params.append('category', filters.category);
    if (filters.search) params.append('search', filters.search);
    if (filters.status) params.append('status', filters.status);

    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/jobs${query}`);
  },

  async createJob(jobData) {
    return this.request('/jobs', {
      method: 'POST',
      body: JSON.stringify(jobData)
    });
  },

  async applyForJob(jobId, proposal) {
    return this.request(`/jobs/${jobId}/apply`, {
      method: 'POST',
      body: JSON.stringify({ proposal })
    });
  },

  async updateJobStatus(jobId, status) {
    return this.request(`/jobs/${jobId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
  }
};

window.Api = Api;
