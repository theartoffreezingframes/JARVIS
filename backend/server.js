const express = require('express');
const cors = require('cors');
const path = require('path');

// Initialize database
require('./db');

const authRoutes = require('./routes/auth');
const coursesRoutes = require('./routes/courses');
const arenaRoutes = require('./routes/arena');
const jobsRoutes = require('./routes/jobs');
const aiRoutes = require('./routes/ai');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend assets from /frontend and /public
app.use(express.static(path.join(__dirname, '../frontend')));
app.use(express.static(path.join(__dirname, '../public')));

// Dedicated direct ZIP download endpoints
app.get('/download', (req, res) => {
  const zipPath = path.join(__dirname, '../OmniCampus-FullStack.zip');
  res.download(zipPath, 'OmniCampus-FullStack.zip');
});

app.get('/OmniCampus-FullStack.zip', (req, res) => {
  const zipPath = path.join(__dirname, '../OmniCampus-FullStack.zip');
  res.download(zipPath, 'OmniCampus-FullStack.zip');
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/courses', coursesRoutes);
app.use('/api/arena', arenaRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/ai', aiRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    platform: 'OmniCampus',
    environment: 'Hyper-Localized College Learning Ecosystem',
    timestamp: new Date().toISOString()
  });
});

// Fallback to index.html for SPA-style client routing
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🎓 OmniCampus Backend Server active!`);
  console.log(`🚀 Listening on http://0.0.0.0:${PORT}`);
  console.log(`📚 Syllabus Courses, AI Explainer & Gigs ready.`);
  console.log(`====================================================`);
});
