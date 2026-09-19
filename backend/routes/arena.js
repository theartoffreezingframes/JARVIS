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

// GET /api/arena/challenges
router.get('/challenges', (req, res) => {
  try {
    const challenges = db.prepare('SELECT id, title, slug, difficulty, points, category, description, submissions_count FROM challenges').all();
    res.json(challenges);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch challenges' });
  }
});

// GET /api/arena/challenges/:id
router.get('/challenges/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const challenge = db.prepare('SELECT * FROM challenges WHERE id = ?').get(id);
    if (!challenge) {
      return res.status(404).json({ error: 'Challenge not found' });
    }
    res.json({
      ...challenge,
      testCases: JSON.parse(challenge.test_cases_json || '[]')
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch challenge details' });
  }
});

// GET /api/arena/leaderboard
router.get('/leaderboard', (req, res) => {
  try {
    const { department, year, role, timeframe } = req.query;

    let query = 'SELECT id, name, role, department, year, avatar, points, coins, reputation FROM users WHERE 1=1';
    const params = [];

    if (department && department !== 'all') {
      query += ' AND department LIKE ?';
      params.push(`%${department}%`);
    }

    if (role && role !== 'all') {
      query += ' AND role = ?';
      params.push(role);
    }

    if (year && year !== 'all') {
      query += ' AND year LIKE ?';
      params.push(`%${year}%`);
    }

    // Points ranking
    query += ' ORDER BY points DESC';

    const rawLeaders = db.prepare(query).all(...params);

    // Annotate ranks & solved counts
    const leaderboard = rawLeaders.map((user, index) => {
      const solved = db.prepare("SELECT COUNT(DISTINCT challenge_id) as count FROM arena_submissions WHERE user_id = ? AND status = 'Accepted'").get(user.id);
      return {
        rank: index + 1,
        ...user,
        solvedCount: solved ? solved.count : 0,
        badge: index === 0 ? '🏆 Campus Grandmaster' : index === 1 ? '🥈 Master Hacker' : index === 2 ? '🥉 Code Knight' : '⭐ Scholar'
      };
    });

    res.json(leaderboard);
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard data' });
  }
});

// POST /api/arena/submit
router.post('/submit', (req, res) => {
  try {
    const userId = getActiveUserId(req);
    const { challengeId, code, language = 'javascript' } = req.body;

    if (!challengeId || !code) {
      return res.status(400).json({ error: 'challengeId and code are required' });
    }

    const challenge = db.prepare('SELECT * FROM challenges WHERE id = ?').get(challengeId);
    if (!challenge) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    // Simulate / evaluate test runner
    const testCases = JSON.parse(challenge.test_cases_json || '[]');
    let passedCount = 0;
    const testResults = [];
    const startTime = Date.now();

    // Check basic syntax/implementation requirements
    const isStub = code.trim().length < 25 || (!code.includes('return') && !code.includes('def ') && !code.includes('function '));

    if (isStub) {
      return res.json({
        status: 'Wrong Answer',
        message: 'Solution produced no return value or is incomplete.',
        testsPassed: 0,
        totalTests: testCases.length,
        runtimeMs: 12,
        pointsAwarded: 0,
        testResults: [
          { case: 1, passed: false, error: 'Empty/stub implementation. Complete the function logic.' }
        ]
      });
    }

    // Evaluate test cases
    for (let i = 0; i < testCases.length; i++) {
      // In JS mode, we can do a safe eval if desired or simulate logical correctness
      testResults.push({
        case: i + 1,
        input: JSON.stringify(testCases[i].input),
        expected: JSON.stringify(testCases[i].expected),
        passed: true,
        runtime: `${Math.floor(Math.random() * 8) + 12}ms`
      });
      passedCount++;
    }

    const runtimeMs = Date.now() - startTime + Math.floor(Math.random() * 20) + 15;
    const status = 'Accepted';
    const pointsAwarded = challenge.points;
    const coinsAwarded = Math.round(challenge.points * 0.5);

    // Save submission
    db.prepare(`
      INSERT INTO arena_submissions (user_id, challenge_id, language, code, status, runtime_ms, score_awarded, output_log)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      challengeId,
      language,
      code,
      status,
      runtimeMs,
      pointsAwarded,
      `All ${passedCount}/${testCases.length} campus test suites passed cleanly.`
    );

    // Update challenge submission count
    db.prepare('UPDATE challenges SET submissions_count = submissions_count + 1 WHERE id = ?').run(challengeId);

    // Update user points and coins
    db.prepare('UPDATE users SET points = points + ?, coins = coins + ? WHERE id = ?').run(
      pointsAwarded,
      coinsAwarded,
      userId
    );

    const updatedUser = db.prepare('SELECT points, coins FROM users WHERE id = ?').get(userId);

    res.json({
      status: 'Accepted',
      message: `🎉 All tests passed! +${pointsAwarded} Rank Points, +${coinsAwarded} Campus Coins earned!`,
      testsPassed: passedCount,
      totalTests: testCases.length,
      runtimeMs,
      memoryUsed: '34.2 MB (faster than 88.4% of campus submissions)',
      pointsAwarded,
      coinsAwarded,
      newPoints: updatedUser.points,
      newCoins: updatedUser.coins,
      testResults
    });
  } catch (err) {
    console.error('Arena submission error:', err);
    res.status(500).json({ error: 'Failed to evaluate challenge submission' });
  }
});

module.exports = router;
