const express = require('express');
const router = express.Router();
const controller = require('../controllers/customChecklistController');
const { authMiddleware, guestRestrictionMiddleware } = require('../middleware/auth');

router.post('/', authMiddleware, guestRestrictionMiddleware, controller.createCustomChecklist);
router.get('/', authMiddleware, guestRestrictionMiddleware, controller.listCustomChecklists);
router.get('/items', authMiddleware, guestRestrictionMiddleware, controller.listCustomChecklistItems);
router.post('/items', authMiddleware, guestRestrictionMiddleware, controller.createCustomChecklistItem);
router.patch('/:id', authMiddleware, guestRestrictionMiddleware, controller.updateCustomChecklist);
router.delete('/:id', authMiddleware, guestRestrictionMiddleware, controller.deleteCustomChecklist);
router.patch('/items/:id', authMiddleware, guestRestrictionMiddleware, controller.updateCustomChecklistItem);
router.delete('/items/:id', authMiddleware, guestRestrictionMiddleware, controller.deleteCustomChecklistItem);

module.exports = router;
