// models/Message.js
// Handles all message types: standard, time capsule, and silent/private

const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  // ── CORE ─────────────────────────────────────────────────────────────────────
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  conversation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
  },

  content: {
    type: String,
    required: true,
    maxlength: [2000, 'Message too long'],
  },

  // ── MESSAGE TYPE ─────────────────────────────────────────────────────────────
  messageType: {
    type: String,
    enum: ['standard', 'timeCapsule', 'silent'],
    default: 'standard',
  },

  // ── PRIORITY (used with Vibe/Focus Mode) ────────────────────────────────────
  // Senders can mark a message as urgent to bypass focus mode filters
  priority: {
    type: String,
    enum: ['normal', 'urgent'],
    default: 'normal',
  },

  // ── TIME CAPSULE FIELDS ──────────────────────────────────────────────────────
  // Message is hidden until unlockAt time is reached
  timeCapsule: {
    isLocked: { type: Boolean, default: false },
    unlockAt: { type: Date },           // Scheduled unlock time
    unlockedAt: { type: Date },         // When it actually unlocked
    // Content is stored encrypted/masked until unlock
    lockedContent: { type: String },    // The real content (hidden until unlock)
  },

  // ── SILENT MESSAGE FIELDS ────────────────────────────────────────────────────
  // Private messages that self-destruct after being read
  silent: {
    isPrivate: { type: Boolean, default: false },
    canForward: { type: Boolean, default: true },
    autoDeleteAfterRead: { type: Boolean, default: false },
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    deletedAfterReadBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },

  // ── READ RECEIPTS ────────────────────────────────────────────────────────────
  readBy: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    readAt: { type: Date, default: Date.now },
  }],

  // ── SOFT DELETE ──────────────────────────────────────────────────────────────
  isDeleted: {
    type: Boolean,
    default: false,
  },

  deletedAt: {
    type: Date,
  },

  // ── EMOJI TRACKING (for Group DNA) ──────────────────────────────────────────
  emojisUsed: [String], // Extracted emojis from content

}, { timestamps: true });

// ── INDEXES for performance ───────────────────────────────────────────────────
MessageSchema.index({ conversation: 1, createdAt: -1 });
MessageSchema.index({ 'timeCapsule.unlockAt': 1, 'timeCapsule.isLocked': 1 });

// Extract emojis from content before saving
MessageSchema.pre('save', function (next) {
  if (this.isModified('content')) {
    const emojiRegex = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu;
    this.emojisUsed = this.content.match(emojiRegex) || [];
  }
  next();
});

module.exports = mongoose.model('Message', MessageSchema);
