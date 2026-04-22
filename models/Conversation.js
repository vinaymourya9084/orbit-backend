// models/Conversation.js
// Supports 1-to-1 and group chats; includes Group DNA analytics storage

const mongoose = require('mongoose');

const ConversationSchema = new mongoose.Schema({
  // ── PARTICIPANTS ──────────────────────────────────────────────────────────────
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  }],

  // ── TYPE ─────────────────────────────────────────────────────────────────────
  isGroup: {
    type: Boolean,
    default: false,
  },

  // ── GROUP FIELDS ─────────────────────────────────────────────────────────────
  groupName: {
    type: String,
    trim: true,
    maxlength: [50, 'Group name too long'],
  },

  groupAdmin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },

  // ── LAST MESSAGE (for sidebar preview) ──────────────────────────────────────
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
  },

  // ── GROUP DNA SYSTEM ─────────────────────────────────────────────────────────
  // Analytics computed from message history, updated periodically
  groupDNA: {
    // Personality classification: fun | serious | chaotic | chill | mixed
    personality: { type: String, default: 'mixed' },

    // Emoji frequency map: { "😂": 42, "🔥": 18, ... }
    emojiFrequency: { type: Map, of: Number, default: {} },

    // Total message count
    totalMessages: { type: Number, default: 0 },

    // Messages per day of week [Sun, Mon, Tue, Wed, Thu, Fri, Sat]
    activityByDay: {
      type: [Number],
      default: [0, 0, 0, 0, 0, 0, 0],
    },

    // Messages per hour of day [0..23]
    activityByHour: {
      type: [Number],
      default: Array(24).fill(0),
    },

    // Top contributors: [{ userId, count }]
    topContributors: [{
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      count: { type: Number, default: 0 },
    }],

    // Top 5 most used emojis (computed)
    topEmojis: [String],

    // Average messages per day (activity level)
    avgMessagesPerDay: { type: Number, default: 0 },

    // Last time DNA was recalculated
    lastComputedAt: { type: Date },
  },

}, { timestamps: true });

// ── INDEXES ───────────────────────────────────────────────────────────────────
ConversationSchema.index({ participants: 1 });
ConversationSchema.index({ updatedAt: -1 });

module.exports = mongoose.model('Conversation', ConversationSchema);
