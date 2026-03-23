const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_only_for_dev';

// Middleware to verify token access
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

// Register
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const existing = db.getUserByUsername(username);
  if (existing) return res.status(400).json({ error: 'User already exists' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const info = db.createUser(username, hash);
    const user = { id: info.lastInsertRowid, username };
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const user = db.getUserByUsername(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const pUser = { id: user.id, username: user.username };
  const token = jwt.sign(pUser, JWT_SECRET, { expiresIn: '7d' });
  
  res.json({ token, user: pUser });
});

// Get current user profile
router.get('/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

module.exports = { router, authenticateToken };
