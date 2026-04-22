// utils/socketHandler.js
// Real-time event handling: messages, vibe changes, focus mode, typing

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Conversation = require('../models/Conversation');

// Map: userId -> socketId (for targeted delivery)
const userSocketMap = new Map();

const initSocket = (io) => {

  // ── AUTHENTICATION MIDDLEWARE ─────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Authentication required'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      if (!user) return next(new Error('User not found'));

      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const user = socket.user;
    console.log(`🔌 ${user.username} connected [${socket.id}]`);

    // ── MARK ONLINE ────────────────────────────────────────────────────────
    userSocketMap.set(user._id.toString(), socket.id);
    await User.findByIdAndUpdate(user._id, {
      isOnline: true,
      socketId: socket.id,
      lastSeen: new Date(),
    });

    // Notify contacts that user came online
    socket.broadcast.emit('userOnline', { userId: user._id, username: user.username });

    // ── JOIN CONVERSATION ROOMS ────────────────────────────────────────────
    socket.on('joinConversations', async () => {
      const conversations = await Conversation.find({ participants: user._id });
      conversations.forEach(conv => socket.join(conv._id.toString()));
      console.log(`📋 ${user.username} joined ${conversations.length} rooms`);
    });

    // ── JOIN SINGLE ROOM ──────────────────────────────────────────────────
    socket.on('joinRoom', (conversationId) => {
      socket.join(conversationId);
    });

    // ── SEND MESSAGE (real-time delivery) ────────────────────────────────
    // Frontend emits this after POST /messages succeeds
    socket.on('sendMessage', async (data) => {
      const { conversationId, message } = data;

      // ── FOCUS MODE FILTERING ─────────────────────────────────────────────
      // Get all participants; check focus mode and vibe of recipients
      const conversation = await Conversation.findById(conversationId)
        .populate('participants', 'focusMode vibe socketId _id');

      if (!conversation) return;

      for (const participant of conversation.participants) {
        const pId = participant._id.toString();
        if (pId === user._id.toString()) continue; // Skip sender

        const recipientSocketId = userSocketMap.get(pId);
        if (!recipientSocketId) continue; // Offline — skip

        // FOCUS MODE: batch non-urgent messages if recipient is in focus mode
        if (participant.focusMode?.active && message.priority !== 'urgent') {
          // Send a batched notification instead of full message
          io.to(recipientSocketId).emit('messageBatched', {
            conversationId,
            messageId: message._id,
            senderUsername: user.username,
            preview: message.messageType === 'silent' ? '🔒 Silent message' :
                     message.messageType === 'timeCapsule' ? '⏰ Time capsule' :
                     message.content?.substring(0, 30) + '...',
          });
          continue;
        }

        // VIBE AWARE: mark as low-priority for "focused" users
        const enrichedMessage = { ...message };
        if (participant.vibe === 'focused' && message.priority !== 'urgent') {
          enrichedMessage.lowPriority = true;
        }

        io.to(recipientSocketId).emit('newMessage', {
          conversationId,
          message: enrichedMessage,
        });
      }

      // Always deliver to sender's own other devices
      socket.to(conversationId).emit('messageSent', { conversationId, messageId: message._id });
    });

    // ── TYPING INDICATOR ──────────────────────────────────────────────────
    socket.on('typing', ({ conversationId }) => {
      socket.to(conversationId).emit('userTyping', {
        conversationId,
        userId: user._id,
        username: user.username,
      });
    });

    socket.on('stopTyping', ({ conversationId }) => {
      socket.to(conversationId).emit('userStoppedTyping', {
        conversationId,
        userId: user._id,
      });
    });

    // ── VIBE CHANGE ─────────────────────────────────────────────────────
    // Broadcast vibe update to all conversations the user is in
    socket.on('vibeChanged', async ({ vibe }) => {
      const conversations = await Conversation.find({ participants: user._id });
      conversations.forEach(conv => {
        socket.to(conv._id.toString()).emit('vibeUpdated', {
          userId: user._id,
          username: user.username,
          vibe,
        });
      });
    });

    // ── FOCUS MODE TOGGLE ─────────────────────────────────────────────────
    socket.on('focusModeToggled', ({ active }) => {
      socket.broadcast.emit('userFocusModeChanged', {
        userId: user._id,
        username: user.username,
        active,
      });
    });

    // ── MESSAGE READ ──────────────────────────────────────────────────────
    socket.on('messageRead', ({ messageId, conversationId }) => {
      socket.to(conversationId).emit('messageReadBy', {
        messageId,
        userId: user._id,
        username: user.username,
        readAt: new Date(),
      });
    });

    // ── DISCONNECT ────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      console.log(`🔌 ${user.username} disconnected`);
      userSocketMap.delete(user._id.toString());
      await User.findByIdAndUpdate(user._id, {
        isOnline: false,
        lastSeen: new Date(),
      });
      socket.broadcast.emit('userOffline', { userId: user._id });
    });
  });
};

module.exports = { initSocket, userSocketMap };
