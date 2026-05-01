// utils/socketHandler.js
// Real-time event handling: messages, vibe changes, focus mode, typing

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');

// Map: userId -> Set<socketId> (supports multiple tabs/devices per user)
const userSocketMap = new Map();

const addUserSocket = (userId, socketId) => {
  const key = userId.toString();
  if (!userSocketMap.has(key)) {
    userSocketMap.set(key, new Set());
  }
  userSocketMap.get(key).add(socketId);
};

const removeUserSocket = (userId, socketId) => {
  const key = userId.toString();
  const sockets = userSocketMap.get(key);
  if (!sockets) return 0;

  sockets.delete(socketId);
  if (sockets.size === 0) {
    userSocketMap.delete(key);
    return 0;
  }

  return sockets.size;
};

const getUserSockets = (userId) => {
  return Array.from(userSocketMap.get(userId.toString()) || []);
};

const isUserOnline = (userId) => {
  return getUserSockets(userId).length > 0;
};

const getConversationForUser = async (conversationId, userId) => {
  if (!conversationId) return null;

  return Conversation.findOne({
    _id: conversationId,
    participants: userId,
  });
};

const serializeMessageForSocket = (message) => {
  const obj = message.toObject ? message.toObject() : { ...message };

  if (obj.timeCapsule?.isLocked) {
    obj.content = null;
    obj.timeCapsule.lockedContent = undefined;
  }

  return obj;
};

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
    const wasOffline = !isUserOnline(user._id);
    addUserSocket(user._id, socket.id);
    await User.findByIdAndUpdate(user._id, {
      isOnline: true,
      lastSeen: new Date(),
    });

    // Notify contacts that user came online
    if (wasOffline) {
      socket.broadcast.emit('userOnline', { userId: user._id, username: user.username });
    }

    // ── JOIN CONVERSATION ROOMS ────────────────────────────────────────────
    socket.on('joinConversations', async () => {
      const conversations = await Conversation.find({ participants: user._id });
      conversations.forEach(conv => socket.join(conv._id.toString()));
      console.log(`📋 ${user.username} joined ${conversations.length} rooms`);
    });

    // ── JOIN SINGLE ROOM ──────────────────────────────────────────────────
    socket.on('joinRoom', async (conversationId) => {
      try {
        const conversation = await getConversationForUser(conversationId, user._id);
        if (!conversation) {
          socket.emit('socketError', { message: 'Not authorized to join this conversation' });
          return;
        }

        socket.join(conversation._id.toString());
      } catch (error) {
        socket.emit('socketError', { message: 'Could not join conversation' });
      }
    });

    // ── SEND MESSAGE (real-time delivery) ────────────────────────────────
    // Frontend emits this after POST /messages succeeds
    socket.on('sendMessage', async (data = {}) => {
      try {
        const { conversationId, message: clientMessage } = data;
        const messageId = clientMessage?._id || data.messageId;

        if (!conversationId || !messageId) {
          socket.emit('socketError', { message: 'Invalid message payload' });
          return;
        }

      // ── FOCUS MODE FILTERING ─────────────────────────────────────────────
      // Get all participants; check focus mode and vibe of recipients
      const conversation = await Conversation.findOne({
          _id: conversationId,
          participants: user._id,
        })
        .populate('participants', 'focusMode vibe socketId _id');

      if (!conversation) {
        socket.emit('socketError', { message: 'Not authorized to send to this conversation' });
        return;
      }

      const persistedMessage = await Message.findOne({
        _id: messageId,
        conversation: conversation._id,
        sender: user._id,
        isDeleted: false,
      }).populate('sender', 'username email vibe');

      if (!persistedMessage) {
        socket.emit('socketError', { message: 'Message could not be verified' });
        return;
      }

      const safeMessage = serializeMessageForSocket(persistedMessage);
      const message = safeMessage;
      const roomId = conversation._id.toString();

      for (const participant of conversation.participants) {
        const pId = participant._id.toString();
        if (pId === user._id.toString()) continue; // Skip sender

        const recipientSocketIds = getUserSockets(pId);
        if (recipientSocketIds.length === 0) continue; // Offline - skip

        // FOCUS MODE: batch non-urgent messages if recipient is in focus mode
        if (participant.focusMode?.active && safeMessage.priority !== 'urgent') {
          // Send a batched notification instead of full message
          recipientSocketIds.forEach(socketId => {
            io.to(socketId).emit('messageBatched', {
            conversationId: roomId,
            messageId: safeMessage._id,
            senderUsername: user.username,
            preview: message.messageType === 'silent' ? '🔒 Silent message' :
                     message.messageType === 'timeCapsule' ? '⏰ Time capsule' :
                     message.content?.substring(0, 30) + '...',
            });
          });
          continue;
        }

        // VIBE AWARE: mark as low-priority for "focused" users
        const enrichedMessage = { ...message };
        if (participant.vibe === 'focused' && message.priority !== 'urgent') {
          enrichedMessage.lowPriority = true;
        }

        recipientSocketIds.forEach(socketId => {
          io.to(socketId).emit('newMessage', {
          conversationId: roomId,
          message: enrichedMessage,
          });
        });
      }

      getUserSockets(user._id)
        .filter(socketId => socketId !== socket.id)
        .forEach(socketId => {
          io.to(socketId).emit('newMessage', {
            conversationId: roomId,
            message,
          });
        });

      // Always deliver to sender's own other devices
      socket.to(roomId).emit('messageSent', { conversationId: roomId, messageId: message._id });
      } catch (error) {
        socket.emit('socketError', { message: 'Could not deliver message' });
      }
    });

    // ── TYPING INDICATOR ──────────────────────────────────────────────────
    socket.on('typing', async ({ conversationId }) => {
      try {
        const conversation = await getConversationForUser(conversationId, user._id);
        if (!conversation) return;

        socket.to(conversation._id.toString()).emit('userTyping', {
          conversationId: conversation._id.toString(),
          userId: user._id,
          username: user.username,
        });
      } catch (error) {}
    });

    socket.on('stopTyping', async ({ conversationId }) => {
      try {
        const conversation = await getConversationForUser(conversationId, user._id);
        if (!conversation) return;

        socket.to(conversation._id.toString()).emit('userStoppedTyping', {
          conversationId: conversation._id.toString(),
          userId: user._id,
        });
      } catch (error) {}
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
    socket.on('messageRead', async ({ messageId, conversationId }) => {
      try {
        const conversation = await getConversationForUser(conversationId, user._id);
        if (!conversation) return;

        const message = await Message.findOne({
          _id: messageId,
          conversation: conversation._id,
        }).select('_id');
        if (!message) return;

        socket.to(conversation._id.toString()).emit('messageReadBy', {
          messageId: message._id,
          userId: user._id,
          username: user.username,
          readAt: new Date(),
        });
      } catch (error) {}
    });

    // ── DISCONNECT ────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      console.log(`🔌 ${user.username} disconnected`);
      const remainingSockets = removeUserSocket(user._id, socket.id);

      if (remainingSockets === 0) {
        await User.findByIdAndUpdate(user._id, {
          isOnline: false,
          socketId: null,
          lastSeen: new Date(),
        });
        socket.broadcast.emit('userOffline', { userId: user._id });
      } else {
        await User.findByIdAndUpdate(user._id, {
          isOnline: true,
          lastSeen: new Date(),
        });
      }
    });
  });
};

module.exports = { initSocket, userSocketMap };
