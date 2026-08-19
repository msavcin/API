const express = require('express');
const router = express.Router();
const controller = require('../controllers/campingTypeController');
const { authMiddleware } = require('../middleware/auth');

// Public/offline sync endpoints
router.get('/', controller.listCampingTypes);
router.get('/sync', controller.syncCampingTypes);

// Superadmin management endpoints
router.get('/admin', authMiddleware, controller.listAdminCampingTypes);
router.post('/admin', authMiddleware, controller.createCampingType);
router.put('/admin/:idOrCode', authMiddleware, controller.updateCampingType);
router.delete('/admin/:idOrCode', authMiddleware, controller.deleteCampingType);

// SVG endpoint
router.get('/:code/icon.svg', controller.getCampingTypeIcon);

module.exports = router;
