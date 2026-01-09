const express = require('express');
const router = express.Router();
const controller = require('../controllers/standardChecklistController');
const { authMiddleware, guestRestrictionMiddleware } = require('../middleware/auth');


router.get('/', authMiddleware, guestRestrictionMiddleware, controller.listStandardChecklists);
// Standart checklist oluşturma (süperadmin)
router.post('/', authMiddleware, guestRestrictionMiddleware, controller.createStandardChecklist); // superadmin
router.get('/items', authMiddleware, guestRestrictionMiddleware, controller.listStandardChecklistItems);
router.post('/items', authMiddleware, guestRestrictionMiddleware, controller.createStandardChecklistItem); // superadmin
router.delete('/items/:id', authMiddleware, guestRestrictionMiddleware, controller.deleteStandardChecklistItem); // superadmin
router.put('/items/:id', authMiddleware, guestRestrictionMiddleware, controller.updateStandardChecklistItem); // superadmin

module.exports = router;
