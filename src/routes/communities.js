const express = require('express');
const { 
  listCommunities, getCommunity, createCommunity, 
  updateCommunity, deleteCommunity 
} = require('../controllers/communityController');
const { authMiddleware, leaderMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/', listCommunities);
router.get('/:id', getCommunity);

module.exports = router;
