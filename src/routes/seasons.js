const express = require('express');
const router = express.Router();
const controller = require('../controllers/seasonController');

router.get('/', controller.listSeasons);

module.exports = router;
