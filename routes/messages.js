// routes/messages.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getMessages,
  sendMessage,
  markAsRead,
  deleteMessage,
} = require('../controllers/messageController');

router.get('/:conversationId', protect, getMessages);
router.post('/', protect, sendMessage);
router.put('/:messageId/read', protect, markAsRead);
router.delete('/:messageId', protect, deleteMessage);

module.exports = router;
