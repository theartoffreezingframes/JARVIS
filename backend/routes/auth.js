const express = require('express');
const router = express.Router();
const db = require('../db');

// Helper to get active user from header or query or default to ID 1 (Alex Rivera)
function getActiveUserId(req) {
  const customId = req.headers['x-user-id'] || req.query.user_id || req.body?.user_id;
  if (customId) {
    const parsed = parseInt(customId, 10);
    if (!isNaN(parsed)) return parsed;
  }
  return 1; // Default: Alex Rivera (Senior Mentor)
}

// GET /api/auth/me
router.get('/me', (req, res) => {
  try {
    const userId = getActiveUserId(req);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get user statistics
    const enrollments = db.prepare('SELECT COUNT(*) as count FROM enrollments WHERE user_id = ?').get(userId);
    const submissions = db.prepare("SELECT COUNT(*) as count FROM arena_submissions WHERE user_id = ? AND status = 'Accepted'").get(userId);
    const jobsCompleted = db.prepare("SELECT COUNT(*) as count FROM micro_jobs WHERE posted_by_user_id = ? AND status = 'completed'").get(userId);

    res.json({
      ...user,
      stats: {
        enrolledCourses: enrollments.count,
        solvedChallenges: submissions.count,
        jobsCompleted: jobsCompleted.count
      }
    });
  } catch (err) {
    console.error('Error fetching current user:', err);
    res.status(500).json({ error: 'Failed to fetch current user' });
  }
});

// GET /api/auth/users
router.get('/users', (req, res) => {
  try {
    const users = db.prepare('SELECT id, name, email, role, department, year, avatar, coins, points, reputation FROM users ORDER BY points DESC').all();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user directory' });
  }
});

// POST /api/auth/login (Demo login or email lookup)
router.post('/login', (req, res) => {
  try {
    const { email, role } = req.body;
    let user;
    if (email) {
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    } else if (role) {
      user = db.prepare('SELECT * FROM users WHERE role = ? LIMIT 1').get(role);
    }

    if (!user) {
      // Fallback to first user
      user = db.prepare('SELECT * FROM users LIMIT 1').get();
    }

    res.json({
      message: `Welcome back, ${user.name}!`,
      user
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/register
router.post('/register', (req, res) => {
  try {
    const { name, email, role, department, year, bio } = req.body;

    if (!name || !email || !role || !department) {
      return res.status(400).json({ error: 'Name, email, role, and department are required.' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).json({ error: 'A student or mentor with this email already exists.' });
    }

    const avatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name)}`;
    const insert = db.prepare(`
      INSERT INTO users (name, email, role, department, year, bio, avatar, coins, points)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1000, 500)
    `);

    const result = insert.run(
      name,
      email,
      role,
      department,
      year || '1st Year',
      bio || 'Passionate OmniCampus learner.',
      avatar
    );

    const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({
      message: 'Account created successfully! Welcome to OmniCampus.',
      user: newUser
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Failed to register new member' });
  }
});

module.exports = router;
