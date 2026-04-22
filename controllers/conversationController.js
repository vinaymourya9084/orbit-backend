// controllers/conversationController.js
// Create and retrieve conversations (1-to-1 and group)

const Conversation = require('../models/Conversation');
const User = require('../models/User');

// ── GET ALL CONVERSATIONS ─────────────────────────────────────────────────────
exports.getConversations = async (req, res) => {
  try {
    const conversations = await Conversation.find({
      participants: req.user._id,
    })
      .populate('participants', 'username email vibe isOnline lastSeen')
      .populate({
        path: 'lastMessage',
        select: 'content sender messageType createdAt timeCapsule silent',
        populate: { path: 'sender', select: 'username' },
      })
      .sort({ updatedAt: -1 });

    res.json({ success: true, conversations });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── CREATE OR GET 1-TO-1 CONVERSATION ────────────────────────────────────────
exports.getOrCreateDM = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId || userId === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'Invalid user' });
    }

    // Check if DM already exists
    let conversation = await Conversation.findOne({
      isGroup: false,
      participants: { $all: [req.user._id, userId], $size: 2 },
    })
      .populate('participants', 'username email vibe isOnline lastSeen focusMode')
      .populate('lastMessage');

    if (!conversation) {
      conversation = await Conversation.create({
        participants: [req.user._id, userId],
        isGroup: false,
      });
      conversation = await Conversation.findById(conversation._id)
        .populate('participants', 'username email vibe isOnline lastSeen focusMode');
    }

    res.json({ success: true, conversation });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── CREATE GROUP CONVERSATION ─────────────────────────────────────────────────
exports.createGroup = async (req, res) => {
  try {
    const { groupName, participantIds } = req.body;

    if (!groupName) {
      return res.status(400).json({ success: false, message: 'Group name required' });
    }

    if (!participantIds || participantIds.length < 2) {
      return res.status(400).json({ success: false, message: 'At least 2 other members required' });
    }

    // Ensure creator is included
    const allParticipants = [...new Set([req.user._id.toString(), ...participantIds])];

    const conversation = await Conversation.create({
      participants: allParticipants,
      isGroup: true,
      groupName,
      groupAdmin: req.user._id,
      // Initialize Group DNA
      groupDNA: {
        personality: 'mixed',
        totalMessages: 0,
        activityByDay: [0, 0, 0, 0, 0, 0, 0],
        activityByHour: Array(24).fill(0),
      },
    });

    const populated = await Conversation.findById(conversation._id)
      .populate('participants', 'username email vibe isOnline');

    res.status(201).json({ success: true, conversation: populated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── GET SINGLE CONVERSATION ───────────────────────────────────────────────────
exports.getConversation = async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      participants: req.user._id,
    }).populate('participants', 'username email vibe isOnline lastSeen focusMode');

    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    res.json({ success: true, conversation });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── GET GROUP DNA ─────────────────────────────────────────────────────────────
exports.getGroupDNA = async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      participants: req.user._id,
      isGroup: true,
    }).populate('groupDNA.topContributors.user', 'username');

    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    res.json({ success: true, groupDNA: conversation.groupDNA });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
