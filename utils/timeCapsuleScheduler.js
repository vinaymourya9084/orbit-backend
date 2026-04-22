// utils/timeCapsuleScheduler.js
// Cron job that runs every minute to unlock time capsule messages
// Uses node-cron for scheduling

const cron = require('node-cron');
const Message = require('../models/Message');

let io; // Socket.IO instance passed from server

const startTimeCapsuleScheduler = (socketIO) => {
  io = socketIO;

  // ── Run every minute ──────────────────────────────────────────────────────
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();

      // Find all locked time capsule messages whose time has come
      const readyMessages = await Message.find({
        messageType: 'timeCapsule',
        'timeCapsule.isLocked': true,
        'timeCapsule.unlockAt': { $lte: now },
        isDeleted: false,
      }).populate('sender', 'username email vibe');

      if (readyMessages.length === 0) return;

      console.log(`⏰ Unlocking ${readyMessages.length} time capsule message(s)`);

      for (const message of readyMessages) {
        // Reveal the real content
        message.content = message.timeCapsule.lockedContent;
        message.timeCapsule.isLocked = false;
        message.timeCapsule.unlockedAt = now;
        message.timeCapsule.lockedContent = undefined;

        await message.save();

        // Broadcast unlock event to all users in the conversation via socket
        if (io) {
          io.to(message.conversation.toString()).emit('timeCapsuleUnlocked', {
            messageId: message._id,
            conversationId: message.conversation,
            content: message.content,
            unlockedAt: now,
            sender: message.sender,
          });
        }
      }
    } catch (error) {
      console.error('Time capsule scheduler error:', error.message);
    }
  });

  console.log('⏰ Time capsule scheduler started');
};

module.exports = { startTimeCapsuleScheduler };
