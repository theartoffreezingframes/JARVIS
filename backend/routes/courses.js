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

// GET /api/courses
router.get('/', (req, res) => {
  try {
    const { department, search, level } = req.query;
    const userId = getActiveUserId(req);

    let query = 'SELECT * FROM courses WHERE 1=1';
    const params = [];

    if (department && department !== 'all') {
      query += ' AND department LIKE ?';
      params.push(`%${department}%`);
    }

    if (level && level !== 'all') {
      query += ' AND level = ?';
      params.push(level);
    }

    if (search && search.trim()) {
      query += ' AND (title LIKE ? OR code LIKE ? OR description LIKE ? OR instructor_name LIKE ?)';
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term);
    }

    query += ' ORDER BY id DESC';

    const courses = db.prepare(query).all(...params);

    // Get user enrollments to annotate each course
    const enrollments = db.prepare('SELECT course_id, progress FROM enrollments WHERE user_id = ?').all(userId);
    const enrollmentMap = new Map(enrollments.map(e => [e.course_id, e.progress]));

    const enrichedCourses = courses.map(course => {
      let syllabus = [];
      try {
        syllabus = JSON.parse(course.syllabus_json);
      } catch (e) {
        syllabus = [];
      }

      const totalLectures = syllabus.reduce((acc, u) => acc + (u.lectures ? u.lectures.length : 0), 0);

      return {
        ...course,
        syllabus,
        totalLectures,
        isEnrolled: enrollmentMap.has(course.id),
        userProgress: enrollmentMap.get(course.id) || 0
      };
    });

    res.json(enrichedCourses);
  } catch (err) {
    console.error('Error fetching courses:', err);
    res.status(500).json({ error: 'Failed to retrieve courses' });
  }
});

// GET /api/courses/:id
router.get('/:id', (req, res) => {
  try {
    const courseId = parseInt(req.params.id, 10);
    const userId = getActiveUserId(req);

    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    let syllabus = [];
    try {
      syllabus = JSON.parse(course.syllabus_json);
    } catch (e) {
      syllabus = [];
    }

    const enrollment = db.prepare('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?').get(userId, courseId);

    res.json({
      ...course,
      syllabus,
      isEnrolled: !!enrollment,
      userProgress: enrollment ? enrollment.progress : 0,
      completedModules: enrollment ? JSON.parse(enrollment.completed_modules_json || '[]') : []
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load course details' });
  }
});

// POST /api/courses - Create Course (Seniors & Admins)
router.post('/', (req, res) => {
  try {
    const userId = getActiveUserId(req);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    if (!user || (user.role !== 'Senior' && user.role !== 'Admin')) {
      return res.status(403).json({
        error: 'Only Seniors and College Admins are authorized to publish syllabus courses.'
      });
    }

    const { code, title, department, semester, description, duration, level, thumbnail_url, video_url, syllabus } = req.body;

    if (!code || !title || !department || !semester || !description) {
      return res.status(400).json({ error: 'Course code, title, department, semester, and description are required.' });
    }

    const defaultSyllabus = Array.isArray(syllabus) && syllabus.length > 0 ? syllabus : [
      {
        unit: 'Unit 1: Fundamentals & Theory',
        lectures: [
          { id: 1, title: 'Introduction & Core Principles', duration: '20 min', videoId: '8hly31xKli0', notes: 'Lecture handout attached.' },
          { id: 2, title: 'Conceptual Architecture', duration: '30 min', videoId: '8hly31xKli0', notes: 'Syllabus reference chapter 2.' }
        ]
      },
      {
        unit: 'Unit 2: Practical Implementation & Lab Prep',
        lectures: [
          { id: 3, title: 'Hands-on Lab Exercise Walkthrough', duration: '35 min', videoId: '8hly31xKli0', notes: 'Sample code provided.' },
          { id: 4, title: 'Exam Review & Viva Preparation', duration: '25 min', videoId: '8hly31xKli0', notes: 'Important questions solved.' }
        ]
      }
    ];

    const insert = db.prepare(`
      INSERT INTO courses (
        code, title, department, semester, instructor_name, instructor_role, instructor_id,
        description, thumbnail_url, video_url, duration, level, rating, enrolled_count, syllabus_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 5.0, 1, ?)
    `);

    const result = insert.run(
      code,
      title,
      department,
      semester,
      user.name,
      `${user.role} Instructor`,
      user.id,
      description,
      thumbnail_url || 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=600&auto=format&fit=crop&q=80',
      video_url || 'https://www.youtube.com/embed/8hly31xKli0',
      duration || '4 hours • 8 lectures',
      level || 'Intermediate',
      JSON.stringify(defaultSyllabus)
    );

    // Give instructor reward points
    db.prepare('UPDATE users SET points = points + 150 WHERE id = ?').run(user.id);

    const newCourse = db.prepare('SELECT * FROM courses WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({
      message: 'Course published successfully and mapped to college curriculum!',
      course: newCourse
    });
  } catch (err) {
    console.error('Course creation error:', err);
    res.status(500).json({ error: 'Failed to create course' });
  }
});

// POST /api/courses/:id/enroll
router.post('/:id/enroll', (req, res) => {
  try {
    const courseId = parseInt(req.params.id, 10);
    const userId = getActiveUserId(req);

    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const existing = db.prepare('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?').get(userId, courseId);
    if (existing) {
      return res.json({ message: 'Already enrolled in this course!', enrollment: existing });
    }

    db.prepare('INSERT INTO enrollments (user_id, course_id, progress, completed_modules_json) VALUES (?, ?, 0, "[]")').run(userId, courseId);
    db.prepare('UPDATE courses SET enrolled_count = enrolled_count + 1 WHERE id = ?').run(courseId);

    res.json({
      message: `Enrolled in ${course.code}: ${course.title} successfully!`,
      progress: 0
    });
  } catch (err) {
    console.error('Enrollment error:', err);
    res.status(500).json({ error: 'Enrollment failed' });
  }
});

// POST /api/courses/:id/progress
router.post('/:id/progress', (req, res) => {
  try {
    const courseId = parseInt(req.params.id, 10);
    const userId = getActiveUserId(req);
    const { progress, lectureId } = req.body;

    const enrollment = db.prepare('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?').get(userId, courseId);
    if (!enrollment) {
      return res.status(400).json({ error: 'You are not enrolled in this course.' });
    }

    let completed = [];
    try {
      completed = JSON.parse(enrollment.completed_modules_json || '[]');
    } catch (e) {
      completed = [];
    }

    if (lectureId && !completed.includes(lectureId)) {
      completed.push(lectureId);
    }

    const newProgress = Math.min(100, Math.max(progress !== undefined ? progress : enrollment.progress + 15, 0));

    db.prepare('UPDATE enrollments SET progress = ?, completed_modules_json = ? WHERE user_id = ? AND course_id = ?').run(
      newProgress,
      JSON.stringify(completed),
      userId,
      courseId
    );

    res.json({
      message: 'Progress synchronized!',
      progress: newProgress,
      completedModules: completed
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update progress' });
  }
});

module.exports = router;
