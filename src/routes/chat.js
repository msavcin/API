const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const { authMiddleware } = require('../middleware/auth');

router.get('/conversations', authMiddleware, chatController.listConversations);
router.get('/conversations/:id/messages', authMiddleware, chatController.getMessages);
router.post('/messages', authMiddleware, chatController.postMessage);
router.patch('/conversations/:id/read', authMiddleware, chatController.markRead);

module.exports = router;
