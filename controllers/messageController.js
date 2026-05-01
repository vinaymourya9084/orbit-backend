// controllers/messageController.js
// Core messaging logic: standard, time capsule, and silent messages

const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const mongoose = require('mongoose');

const VALID_MESSAGE_TYPES = new Set(['standard', 'timeCapsule', 'silent']);
const VALID_PRIORITIES = new Set(['normal', 'urgent']);
const MAX_MESSAGE_LENGTH = 2000;

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// ── GET MESSAGES ──────────────────────────────────────────────────────────────
exports.getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    if (!isValidObjectId(conversationId)) {
      return res.status(400).json({ success: false, message: 'Invalid conversation id' });
    }

    // Confirm user is a participant
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: req.user._id,
    });
    if (!conversation) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const messages = await Message.find({
      conversation: conversationId,
      isDeleted: false,
    })
      .populate('sender', 'username email vibe')
      .sort({ createdAt: 1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    // For time capsule messages: reveal content only if unlocked
    const processed = messages.map(msg => processMsgForClient(msg, req.user._id));

    res.json({ success: true, messages: processed });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── SEND MESSAGE ──────────────────────────────────────────────────────────────
exports.sendMessage = async (req, res) => {
  try {
    const {
      conversationId,
      content,
      messageType = 'standard',
      priority = 'normal',
      unlockAt,        // For time capsule
      isPrivate,       // For silent mode
      autoDelete,      // For silent mode
    } = req.body;

    if (!isValidObjectId(conversationId)) {
      return res.status(400).json({ success: false, message: 'Invalid conversation id' });
    }

    if (typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ success: false, message: 'Message content required' });
    }

    if (content.trim().length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ success: false, message: 'Message too long' });
    }

    if (!VALID_MESSAGE_TYPES.has(messageType)) {
      return res.status(400).json({ success: false, message: 'Invalid message type' });
    }

    if (!VALID_PRIORITIES.has(priority)) {
      return res.status(400).json({ success: false, message: 'Invalid message priority' });
    }

    // Verify access
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: req.user._id,
    }).populate('participants', 'vibe focusMode');

    if (!conversation) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // ── Build message based on type ──────────────────────────────────────────
    const messageData = {
      sender: req.user._id,
      conversation: conversation._id,
      content: content.trim(),
      messageType,
      priority,
    };

    // TIME CAPSULE: lock content until unlock time
    if (messageType === 'timeCapsule') {
      if (!unlockAt) {
        return res.status(400).json({ success: false, message: 'Unlock time required for time capsule' });
      }
      const unlockDate = new Date(unlockAt);
      if (Number.isNaN(unlockDate.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid unlock time' });
      }
      if (unlockDate <= new Date()) {
        return res.status(400).json({ success: false, message: 'Unlock time must be in the future' });
      }
      messageData.timeCapsule = {
        isLocked: true,
        unlockAt: unlockDate,
        lockedContent: content.trim(), // Real content stored here
      };
      // Mask the visible content until unlock
      messageData.content = '🔒 Time Capsule — unlocks ' + unlockDate.toLocaleString();
    }

    // SILENT MESSAGE: private, no-forward, auto-delete
    if (messageType === 'silent' || isPrivate) {
      messageData.messageType = 'silent';
      messageData.silent = {
        isPrivate: true,
        canForward: false,
        autoDeleteAfterRead: autoDelete !== false, // Default true for silent
        readBy: [],
        deletedAfterReadBy: [],
      };
    }

    const message = await Message.create(messageData);

    // ── Update conversation's last message ───────────────────────────────────
    conversation.lastMessage = message._id;
    conversation.updatedAt = new Date();

    // ── Update Group DNA analytics ────────────────────────────────────────────
    if (conversation.isGroup) {
      updateGroupDNA(conversation, message, req.user._id);
    }

    await conversation.save();

    // Populate sender info before emitting
    const populated = await Message.findById(message._id)
      .populate('sender', 'username email vibe');

    const forClient = processMsgForClient(populated, req.user._id);

    res.status(201).json({ success: true, message: forClient });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── MARK MESSAGE AS READ ───────────────────────────────────────────────────────
exports.markAsRead = async (req, res) => {
  try {
    const { messageId } = req.params;

    if (!isValidObjectId(messageId)) {
      return res.status(400).json({ success: false, message: 'Invalid message id' });
    }

    const message = await Message.findOne({ _id: messageId, isDeleted: false });

    if (!message) return res.status(404).json({ success: false, message: 'Message not found' });

    const hasAccess = await Conversation.exists({
      _id: message.conversation,
      participants: req.user._id,
    });

    if (!hasAccess) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Add to readBy if not already there
    const alreadyRead = message.readBy.some(r => r.user.toString() === req.user._id.toString());
    if (!alreadyRead) {
      message.readBy.push({ user: req.user._id, readAt: new Date() });
    }

    // SILENT: track reads and auto-delete for this user
    if (message.silent?.autoDeleteAfterRead) {
      const alreadyInSilent = message.silent.readBy.some(
        id => id.toString() === req.user._id.toString()
      );
      if (!alreadyInSilent) {
        message.silent.readBy.push(req.user._id);
      }
    }

    await message.save();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── DELETE MESSAGE ─────────────────────────────────────────────────────────────
exports.deleteMessage = async (req, res) => {
  try {
    const message = await Message.findOne({
      _id: req.params.messageId,
      sender: req.user._id,
    });

    if (!message) return res.status(404).json({ success: false, message: 'Message not found' });

    message.isDeleted = true;
    message.deletedAt = new Date();
    message.content = 'This message was deleted';
    await message.save();

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── HELPER: Process message for client output ─────────────────────────────────
// Hides locked time capsule content; filters silent messages
function processMsgForClient(msg, userId) {
  const obj = msg.toObject ? msg.toObject() : { ...msg };

  // TIME CAPSULE: mask content if still locked
  if (obj.timeCapsule?.isLocked && obj.timeCapsule.unlockAt > new Date()) {
    obj.content = null; // Frontend shows countdown instead
    obj.timeCapsule.lockedContent = undefined; // Never expose raw content
  } else if (obj.timeCapsule?.isLocked && obj.timeCapsule.unlockAt <= new Date()) {
    // Auto-unlock: reveal the real content
    obj.content = obj.timeCapsule.lockedContent;
    obj.timeCapsule.isLocked = false;
    obj.timeCapsule.lockedContent = undefined;
    // Async unlock in DB (don't await here)
    Message.findByIdAndUpdate(obj._id, {
      content: obj.content,
      'timeCapsule.isLocked': false,
      'timeCapsule.unlockedAt': new Date(),
    }).exec();
  }

  return obj;
}

// ── HELPER: Update Group DNA analytics ───────────────────────────────────────
// Called on every group message — lightweight analytics, no ML needed
function updateGroupDNA(conversation, message, userId) {
  const dna = conversation.groupDNA;
  const now = new Date();

  // Increment total count
  dna.totalMessages = (dna.totalMessages || 0) + 1;

  // Activity by day of week
  const day = now.getDay(); // 0=Sun
  if (!dna.activityByDay) dna.activityByDay = [0,0,0,0,0,0,0];
  dna.activityByDay[day] = (dna.activityByDay[day] || 0) + 1;

  // Activity by hour
  const hour = now.getHours();
  if (!dna.activityByHour) dna.activityByHour = Array(24).fill(0);
  dna.activityByHour[hour] = (dna.activityByHour[hour] || 0) + 1;

  // Track emoji usage
  if (message.emojisUsed && message.emojisUsed.length > 0) {
    if (!dna.emojiFrequency) dna.emojiFrequency = new Map();
    message.emojisUsed.forEach(emoji => {
      const current = dna.emojiFrequency.get(emoji) || 0;
      dna.emojiFrequency.set(emoji, current + 1);
    });
  }

  // Update top contributors
  if (!dna.topContributors) dna.topContributors = [];
  const contributor = dna.topContributors.find(c => c.user?.toString() === userId.toString());
  if (contributor) {
    contributor.count += 1;
  } else {
    dna.topContributors.push({ user: userId, count: 1 });
  }

  // Compute personality based on emoji ratio and activity
  const emojiTotal = Array.from(dna.emojiFrequency?.values() || []).reduce((a, b) => a + b, 0);
  const emojiRatio = emojiTotal / Math.max(dna.totalMessages, 1);
  const maxHourActivity = Math.max(...(dna.activityByHour || [0]));
  const activitySpread = (dna.activityByHour || []).filter(h => h > 0).length;

  if (emojiRatio > 0.5 && activitySpread > 15) {
    dna.personality = 'chaotic';
  } else if (emojiRatio > 0.3) {
    dna.personality = 'fun';
  } else if (emojiRatio < 0.1 && dna.totalMessages > 20) {
    dna.personality = 'serious';
  } else if (activitySpread < 8 && dna.totalMessages > 10) {
    dna.personality = 'chill';
  } else {
    dna.personality = 'mixed';
  }

  // Top emojis (sorted by frequency)
  dna.topEmojis = Array.from(dna.emojiFrequency?.entries() || [])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([emoji]) => emoji);

  dna.lastComputedAt = now;
  conversation.markModified('groupDNA');
}

module.exports = { ...exports, processMsgForClient };
