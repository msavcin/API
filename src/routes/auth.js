const express = require('express');
const router = express.Router();
const { refreshToken } = require('../controllers/userController');

// Refresh token endpointi (body içinde gönderilen refreshToken ile yenileme)
router.post('/refresh', refreshToken);

module.exports = router;
