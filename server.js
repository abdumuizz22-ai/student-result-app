require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt  = require('bcryptjs');
const cors    = require('cors');
const mysql   = require('mysql2/promise');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 8080;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'frontend')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'devSecret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));

const isRDS = process.env.DB_HOST && !['localhost','127.0.0.1'].includes(process.env.DB_HOST);
const pool  = mysql.createPool({
  host:     process.env.DB_HOST,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port:     process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  ...(isRDS && { ssl: { rejectUnauthorized: false } })
});

async function initDB() {
  const c = await pool.getConnection();
  await c.query(`CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, email VARCHAR(150) NOT NULL UNIQUE, password VARCHAR(255) NOT NULL, role ENUM('admin','teacher','student') NOT NULL DEFAULT 'student', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  await c.query(`CREATE TABLE IF NOT EXISTS subjects (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, code VARCHAR(20) NOT NULL UNIQUE, teacher_id INT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE SET NULL)`);
  await c.query(`CREATE TABLE IF NOT EXISTS grades (id INT AUTO_INCREMENT PRIMARY KEY, student_id INT NOT NULL, subject_id INT NOT NULL, marks DECIMAL(5,2) NOT NULL, total DECIMAL(5,2) NOT NULL DEFAULT 100, grade VARCHAR(5), remarks VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE, UNIQUE KEY unique_grade (student_id, subject_id))`);
  const [existing] = await c.query('SELECT id FROM users WHERE email = ?', ['admin@school.com']);
  if (!existing.length) {
    const hash = await bcrypt.hash('admin123', 10);
    await c.query('INSERT INTO users (name, email, password, role) VALUES (?,?,?,?)', ['Administrator', 'admin@school.com', hash, 'admin']);
    console.log('🌱  Default admin created: admin@school.com / admin123');
  }
  c.release();
  console.log('✅  Database ready');
}

const requireAuth = (role) => (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  if (role && req.session.user.role !== role && req.session.user.role !== 'admin')
    return res.status(403).json({ error: 'Forbidden' });
  next();
};

function gradeFromMarks(marks, total) {
  const pct = (marks / total) * 100;
  if (pct >= 90) return 'A+';
  if (pct >= 80) return 'A';
  if (pct >= 70) return 'B';
  if (pct >= 60) return 'C';
  if (pct >= 50) return 'D';
  return 'F';
}

// AUTH
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, role = 'student' } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
  if (!['student','teacher'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const [r] = await pool.query('INSERT INTO users (name, email, password, role) VALUES (?,?,?,?)', [name, email, hash, role]);
    res.status(201).json({ message: 'Registered successfully', id: r.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    res.json({ message: 'Login successful', user: req.session.user });
  } catch (err) { res.status(500).json({ error: 'Login failed' }); }
});

app.post('/api/auth/logout', (req, res) => { req.session.destroy(); res.json({ message: 'Logged out' }); });
app.get('/api/auth/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json(req.session.user);
});

// ADMIN
app.get('/api/admin/users', requireAuth('admin'), async (req, res) => {
  const [rows] = await pool.query('SELECT id, name, email, role, created_at FROM users ORDER BY role, name');
  res.json(rows);
});
app.delete('/api/admin/users/:id', requireAuth('admin'), async (req, res) => {
  await pool.query('DELETE FROM users WHERE id = ? AND role != "admin"', [req.params.id]);
  res.json({ message: 'User deleted' });
});
app.put('/api/admin/users/:id', requireAuth('admin'), async (req, res) => {
  await pool.query('UPDATE users SET role = ? WHERE id = ?', [req.body.role, req.params.id]);
  res.json({ message: 'Role updated' });
});
app.get('/api/admin/stats', requireAuth('admin'), async (req, res) => {
  const [[{ students }]] = await pool.query('SELECT COUNT(*) as students FROM users WHERE role="student"');
  const [[{ teachers }]] = await pool.query('SELECT COUNT(*) as teachers FROM users WHERE role="teacher"');
  const [[{ subjects }]] = await pool.query('SELECT COUNT(*) as subjects FROM subjects');
  const [[{ grades }]]   = await pool.query('SELECT COUNT(*) as grades FROM grades');
  res.json({ students, teachers, subjects, grades });
});

// SUBJECTS — teachers only see & manage their own
app.get('/api/subjects', requireAuth(), async (req, res) => {
  const { id, role } = req.session.user;
  const isAdmin = role === 'admin';
  const [rows] = await pool.query(
    `SELECT s.*, u.name as teacher_name FROM subjects s LEFT JOIN users u ON s.teacher_id = u.id ${isAdmin ? '' : 'WHERE s.teacher_id = ?'} ORDER BY s.name`,
    isAdmin ? [] : [id]
  );
  res.json(rows);
});

app.post('/api/subjects', requireAuth('teacher'), async (req, res) => {
  const { name, code } = req.body;
  if (!name || !code) return res.status(400).json({ error: 'Name and code required' });
  try {
    const teacher_id = req.session.user.role === 'admin' ? null : req.session.user.id;
    const [r] = await pool.query('INSERT INTO subjects (name, code, teacher_id) VALUES (?,?,?)', [name, code.toUpperCase(), teacher_id]);
    res.status(201).json({ id: r.insertId, name, code: code.toUpperCase() });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Subject code already exists' });
    res.status(500).json({ error: 'Failed to create subject' });
  }
});

app.delete('/api/subjects/:id', requireAuth('teacher'), async (req, res) => {
  const { id, role } = req.session.user;
  const [check] = await pool.query('SELECT teacher_id FROM subjects WHERE id = ?', [req.params.id]);
  if (!check.length) return res.status(404).json({ error: 'Subject not found' });
  if (role !== 'admin' && check[0].teacher_id !== id)
    return res.status(403).json({ error: 'You can only delete your own subjects' });
  await pool.query('DELETE FROM subjects WHERE id = ?', [req.params.id]);
  res.json({ message: 'Subject deleted' });
});

// GRADES — teachers can only enter/delete grades for their own subjects
app.get('/api/grades/student/:studentId', requireAuth(), async (req, res) => {
  const sid = req.params.studentId;
  if (req.session.user.role === 'student' && req.session.user.id != sid)
    return res.status(403).json({ error: 'Forbidden' });
  const [rows] = await pool.query(
    `SELECT g.*, s.name as subject_name, s.code as subject_code FROM grades g JOIN subjects s ON g.subject_id = s.id WHERE g.student_id = ? ORDER BY s.name`,
    [sid]
  );
  res.json(rows);
});

app.get('/api/grades/all', requireAuth('teacher'), async (req, res) => {
  const { id, role } = req.session.user;
  const isAdmin = role === 'admin';
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.email,
       ROUND(AVG(g.marks/g.total*100),1) as avg_percentage,
       COUNT(g.id) as subjects_graded
     FROM users u
     LEFT JOIN grades g ON u.id = g.student_id
     ${isAdmin ? '' : 'LEFT JOIN subjects s ON g.subject_id = s.id'}
     WHERE u.role = 'student'
     ${isAdmin ? '' : 'AND (s.teacher_id = ? OR g.id IS NULL)'}
     GROUP BY u.id ORDER BY u.name`,
    isAdmin ? [] : [id]
  );
  res.json(rows);
});

app.post('/api/grades', requireAuth('teacher'), async (req, res) => {
  const { student_id, subject_id, marks, total = 100, remarks = '' } = req.body;
  if (!student_id || !subject_id || marks === undefined)
    return res.status(400).json({ error: 'student_id, subject_id and marks are required' });

  // Block teacher from grading other teachers' subjects
  if (req.session.user.role !== 'admin') {
    const [check] = await pool.query('SELECT teacher_id FROM subjects WHERE id = ?', [subject_id]);
    if (!check.length) return res.status(404).json({ error: 'Subject not found' });
    if (check[0].teacher_id !== req.session.user.id)
      return res.status(403).json({ error: 'You can only enter grades for your own subjects' });
  }

  const grade = gradeFromMarks(marks, total);
  try {
    await pool.query(
      `INSERT INTO grades (student_id, subject_id, marks, total, grade, remarks) VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE marks=VALUES(marks), total=VALUES(total), grade=VALUES(grade), remarks=VALUES(remarks)`,
      [student_id, subject_id, marks, total, grade, remarks]
    );
    res.json({ message: 'Grade saved', grade });
  } catch (err) { res.status(500).json({ error: 'Failed to save grade' }); }
});

app.delete('/api/grades/:id', requireAuth('teacher'), async (req, res) => {
  const { id, role } = req.session.user;
  if (role !== 'admin') {
    const [check] = await pool.query(
      `SELECT s.teacher_id FROM grades g JOIN subjects s ON g.subject_id = s.id WHERE g.id = ?`,
      [req.params.id]
    );
    if (!check.length) return res.status(404).json({ error: 'Grade not found' });
    if (check[0].teacher_id !== id)
      return res.status(403).json({ error: 'You can only delete grades for your own subjects' });
  }
  await pool.query('DELETE FROM grades WHERE id = ?', [req.params.id]);
  res.json({ message: 'Grade deleted' });
});

app.get('/api/grades/report/:studentId', requireAuth(), async (req, res) => {
  const sid = req.params.studentId;
  if (req.session.user.role === 'student' && req.session.user.id != sid)
    return res.status(403).json({ error: 'Forbidden' });
  const [[student]] = await pool.query('SELECT id, name, email FROM users WHERE id = ?', [sid]);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const [grades] = await pool.query(
    `SELECT g.*, s.name as subject_name, s.code as subject_code FROM grades g JOIN subjects s ON g.subject_id = s.id WHERE g.student_id = ? ORDER BY s.name`,
    [sid]
  );
  const totalMarks    = grades.reduce((a, g) => a + parseFloat(g.marks), 0);
  const totalPossible = grades.reduce((a, g) => a + parseFloat(g.total), 0);
  const percentage    = totalPossible ? ((totalMarks / totalPossible) * 100).toFixed(1) : 0;
  const overallGrade  = gradeFromMarks(totalMarks, totalPossible || 1);
  res.json({ student, grades, totalMarks, totalPossible, percentage, overallGrade });
});

app.get('/api/students', requireAuth('teacher'), async (req, res) => {
  const [rows] = await pool.query('SELECT id, name, email FROM users WHERE role = "student" ORDER BY name');
  res.json(rows);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/index.html'));
});

initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`🚀  Student Result System running on port ${PORT}`));
}).catch(err => { console.error('❌  DB init failed:', err); process.exit(1); });
