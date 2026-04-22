// routes/conversations.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getConversations,
  getOrCreateDM,
  createGroup,
  getConversation,
  getGroupDNA,
} = require('../controllers/conversationController');

router.get('/', protect, getConversations);
router.post('/dm', protect, getOrCreateDM);
router.post('/group', protect, createGroup);
router.get('/:id', protect, getConversation);
router.get('/:id/dna', protect, getGroupDNA);

module.exports = router;
