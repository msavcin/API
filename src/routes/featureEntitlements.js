const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const controller = require('../controllers/featureEntitlementController');

router.get('/me', authMiddleware, controller.getMyEntitlements);
router.get('/admin/users', authMiddleware, controller.listUsers);
router.get('/admin/global', authMiddleware, controller.getGlobal);
router.put('/admin/global', authMiddleware, controller.updateGlobal);
router.get('/admin/users/:userId', authMiddleware, controller.getEffectiveForUser);
router.put('/admin/users/:userId', authMiddleware, controller.updateUser);
router.post('/admin/users/:userId/start-trial', authMiddleware, controller.startTrial);
router.post('/admin/users/:userId/revoke-trial', authMiddleware, controller.revokeTrial);
router.delete('/admin/users/:userId/:featureKey', authMiddleware, controller.clearUserFeature);

module.exports = router;
