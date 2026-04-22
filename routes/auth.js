// routes/auth.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  register, login, getMe, searchUsers, updateVibe, toggleFocusMode
} = require('../controllers/authController');

router.post('/register', register);
router.post('/login', login);
router.get('/me', protect, getMe);
router.get('/search', protect, searchUsers);
router.put('/vibe', protect, updateVibe);
router.put('/focus-mode', protect, toggleFocusMode);

module.exports = router;
