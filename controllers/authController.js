// controllers/authController.js
// Handles user registration, login, and profile operations

const User = require('../models/User');
const { generateToken } = require('../middleware/auth');

// ── REGISTER ──────────────────────────────────────────────────────────────────
exports.register = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Check for existing user
    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: existing.email === email ? 'Email already in use' : 'Username taken',
      });
    }

    const user = await User.create({ username, email, password });
    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      token,
      user: user.toPublicJSON(),
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── LOGIN ─────────────────────────────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide email and password' });
    }

    // Explicitly select password for comparison
    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = generateToken(user._id);

    res.json({
      success: true,
      token,
      user: user.toPublicJSON(),
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── GET CURRENT USER ──────────────────────────────────────────────────────────
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.json({ success: true, user: user.toPublicJSON() });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── SEARCH USERS ─────────────────────────────────────────────────────────────
exports.searchUsers = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) {
      return res.json({ success: true, users: [] });
    }

    const users = await User.find({
      _id: { $ne: req.user._id }, // Exclude self
      username: { $regex: q, $options: 'i' },
    }).select('username email vibe isOnline lastSeen').limit(10);

    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── UPDATE VIBE ───────────────────────────────────────────────────────────────
// Core Vibe Status System: update vibe and broadcast via socket
exports.updateVibe = async (req, res) => {
  try {
    const { vibe } = req.body;
    const validVibes = ['focused', 'chill', 'busy', 'excited'];

    if (!validVibes.includes(vibe)) {
      return res.status(400).json({ success: false, message: 'Invalid vibe' });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { vibe, vibeUpdatedAt: new Date() },
      { new: true }
    );

    res.json({ success: true, vibe: user.vibe, user: user.toPublicJSON() });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── TOGGLE FOCUS MODE ─────────────────────────────────────────────────────────
// Focus Mode: activate/deactivate smart notification filtering
exports.toggleFocusMode = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const nowActive = !user.focusMode.active;

    user.focusMode.active = nowActive;
    if (nowActive) user.focusMode.activatedAt = new Date();
    await user.save();

    res.json({
      success: true,
      focusMode: user.focusMode,
      message: nowActive ? 'Focus mode activated' : 'Focus mode deactivated',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
