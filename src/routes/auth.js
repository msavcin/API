const express = require('express');
const router = express.Router();
const { refreshToken } = require('../controllers/userController');
const { authMiddleware } = require('../middleware/auth');

// Refresh token endpointi (JWT süresi dolmadan yenilemek için)
router.post('/refresh', authMiddleware, refreshToken);

module.exports = router;
