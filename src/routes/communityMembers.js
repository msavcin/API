const express = require('express');
const { 
  joinCommunity, listMembers, approveMember, rejectMember, removeMember, getMember 
} = require('../controllers/communityMemberController');
const { authMiddleware, leaderMiddleware, guestRestrictionMiddleware } = require('../middleware/auth');


const router = express.Router();
// Belirli bir topluluk ve kullanıcı için üyelik detayını getir
router.get('/:id/members/:userId', authMiddleware, guestRestrictionMiddleware, getMember);

router.post('/:id/join', authMiddleware, guestRestrictionMiddleware, joinCommunity);
router.get('/:id/members', authMiddleware, guestRestrictionMiddleware, listMembers);
router.put('/:id/members/:userId/approve', authMiddleware, guestRestrictionMiddleware, leaderMiddleware, approveMember);
router.put('/:id/members/:userId/reject', authMiddleware, guestRestrictionMiddleware, leaderMiddleware, rejectMember);
router.delete('/:id/members/:userId', authMiddleware, guestRestrictionMiddleware, leaderMiddleware, removeMember);

// Genel status güncelleme endpointi
const { updateMemberStatus } = require('../controllers/communityMemberController');
router.put('/:id/members/:userId/status', authMiddleware, leaderMiddleware, updateMemberStatus);

module.exports = router;
