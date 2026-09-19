const express = require('express');
const router = express.Router();
const db = require('../db');

function getActiveUserId(req) {
  const customId = req.headers['x-user-id'] || req.query.user_id || req.body?.user_id;
  if (customId) {
    const parsed = parseInt(customId, 10);
    if (!isNaN(parsed)) return parsed;
  }
  return 1;
}

// GET /api/jobs
router.get('/', (req, res) => {
  try {
    const { category, search, status } = req.query;
    const userId = getActiveUserId(req);

    let query = 'SELECT * FROM micro_jobs WHERE 1=1';
    const params = [];

    if (category && category !== 'all') {
      query += ' AND category = ?';
      params.push(category);
    }

    if (status && status !== 'all') {
      query += ' AND status = ?';
      params.push(status);
    }

    if (search && search.trim()) {
      query += ' AND (title LIKE ? OR description LIKE ? OR posted_by_name LIKE ?)';
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    query += ' ORDER BY id DESC';

    const jobs = db.prepare(query).all(...params);

    // Annotate jobs if user has already applied
    const applications = db.prepare('SELECT job_id FROM job_applications WHERE applicant_user_id = ?').all(userId);
    const appliedJobIds = new Set(applications.map(a => a.job_id));

    const enrichedJobs = jobs.map(job => ({
      ...job,
      hasApplied: appliedJobIds.has(job.id),
      isOwner: job.posted_by_user_id === userId
    }));

    res.json(enrichedJobs);
  } catch (err) {
    console.error('Jobs fetch error:', err);
    res.status(500).json({ error: 'Failed to retrieve micro-jobs' });
  }
});

// POST /api/jobs
router.post('/', (req, res) => {
  try {
    const userId = getActiveUserId(req);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    const { title, category, description, bounty_coins, deadline } = req.body;

    if (!title || !category || !description || !bounty_coins) {
      return res.status(400).json({ error: 'Title, category, description, and bounty are required.' });
    }

    const bounty = parseInt(bounty_coins, 10);
    if (isNaN(bounty) || bounty < 50) {
      return res.status(400).json({ error: 'Minimum bounty is 50 Campus Coins.' });
    }

    if (user.coins < bounty) {
      return res.status(400).json({
        error: `Insufficient balance! You have ${user.coins} coins, but the bounty requires ${bounty} coins.`
      });
    }

    // Deduct coins into escrow
    db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(bounty, userId);

    const insert = db.prepare(`
      INSERT INTO micro_jobs (
        title, category, description, bounty_coins, posted_by_user_id,
        posted_by_name, posted_by_role, deadline, status, applications_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', 0)
    `);

    const result = insert.run(
      title,
      category,
      description,
      bounty,
      user.id,
      user.name,
      user.role,
      deadline || 'In 3 days'
    );

    const createdJob = db.prepare('SELECT * FROM micro_jobs WHERE id = ?').get(result.lastInsertRowid);

    res.status(201).json({
      message: 'Micro-task posted to Campus Gig Board! Bounty placed in student escrow.',
      job: createdJob
    });
  } catch (err) {
    console.error('Job posting error:', err);
    res.status(500).json({ error: 'Failed to post micro-job' });
  }
});

// POST /api/jobs/:id/apply
router.post('/:id/apply', (req, res) => {
  try {
    const jobId = parseInt(req.params.id, 10);
    const userId = getActiveUserId(req);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const { proposal } = req.body;

    if (!proposal || proposal.trim().length < 10) {
      return res.status(400).json({ error: 'Please write a brief pitch/proposal explaining your skills and delivery timeline.' });
    }

    const job = db.prepare('SELECT * FROM micro_jobs WHERE id = ?').get(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.status !== 'open') {
      return res.status(400).json({ error: 'This micro-task is no longer accepting applications.' });
    }

    const existing = db.prepare('SELECT id FROM job_applications WHERE job_id = ? AND applicant_user_id = ?').get(jobId, userId);
    if (existing) {
      return res.status(400).json({ error: 'You have already applied for this micro-task.' });
    }

    db.prepare(`
      INSERT INTO job_applications (job_id, applicant_user_id, applicant_name, applicant_role, applicant_department, proposal)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      jobId,
      userId,
      user.name,
      user.role,
      user.department,
      proposal.trim()
    );

    db.prepare('UPDATE micro_jobs SET applications_count = applications_count + 1 WHERE id = ?').run(jobId);

    res.status(201).json({
      message: `Proposal submitted to ${job.posted_by_name}! You will be notified when selected.`,
      applicationsCount: job.applications_count + 1
    });
  } catch (err) {
    console.error('Application error:', err);
    res.status(500).json({ error: 'Failed to submit application' });
  }
});

// PATCH /api/jobs/:id/status
router.patch('/:id/status', (req, res) => {
  try {
    const jobId = parseInt(req.params.id, 10);
    const { status } = req.body;

    if (!['open', 'in_progress', 'completed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }

    db.prepare('UPDATE micro_jobs SET status = ? WHERE id = ?').run(status, jobId);
    res.json({ message: `Job marked as ${status}`, status });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update job status' });
  }
});

module.exports = router;
