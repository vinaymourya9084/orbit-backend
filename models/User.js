// models/User.js
// Core user model — stores auth, vibe, and focus mode state

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: [true, 'Username is required'],
    unique: true,
    trim: true,
    minlength: [3, 'Username must be at least 3 characters'],
    maxlength: [20, 'Username cannot exceed 20 characters'],
  },

  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
  },

  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false, // Never return password in queries
  },

  avatar: {
    type: String,
    default: '', // Will use initials-based avatar on frontend
  },

  // ── VIBE STATUS SYSTEM ──────────────────────────────────────────────────────
  // Controls how incoming messages are treated and how UI adapts
  vibe: {
    type: String,
    enum: ['focused', 'chill', 'busy', 'excited'],
    default: 'chill',
  },

  vibeUpdatedAt: {
    type: Date,
    default: Date.now,
  },

  // ── FOCUS MODE ──────────────────────────────────────────────────────────────
  // When active, only priority messages are delivered immediately
  focusMode: {
    active: { type: Boolean, default: false },
    activatedAt: { type: Date },
    // Batched messages are shown after this interval (minutes)
    batchIntervalMinutes: { type: Number, default: 30 },
  },

  // ── ONLINE STATUS ───────────────────────────────────────────────────────────
  isOnline: {
    type: Boolean,
    default: false,
  },

  lastSeen: {
    type: Date,
    default: Date.now,
  },

  socketId: {
    type: String,
    default: null,
  },

}, { timestamps: true });

// Hash password before saving
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare entered password with stored hash
UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Return safe public profile (no password)
UserSchema.methods.toPublicJSON = function () {
  return {
    _id: this._id,
    username: this.username,
    email: this.email,
    avatar: this.avatar,
    vibe: this.vibe,
    focusMode: this.focusMode,
    isOnline: this.isOnline,
    lastSeen: this.lastSeen,
  };
};

module.exports = mongoose.model('User', UserSchema);
