const express = require('express');
const router = express.Router();
const controller = require('../controllers/campingTypeController');

router.get('/', controller.listCampingTypes);

module.exports = router;
