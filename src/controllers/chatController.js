const db = require('../models');
const { Op } = require('sequelize');

async function getActiveCommunityIds(userId) {
  const CommunityMember = db.CommunityMember || require('../models/communityMember');
  const memberships = await CommunityMember.findAll({ where: { user_id: userId, status: 'active' }, attributes: ['community_id'] });
  return memberships.map(m => m.community_id).filter(id => id !== null);
}

async function ensureCommunityConversationParticipants(communityId, conversationId, senderId) {
  const CommunityMember = db.CommunityMember || require('../models/communityMember');
  const Participant = db.ChatConversationParticipant || require('../models/chatConversationParticipant');
  const members = await CommunityMember.findAll({ where: { community_id: communityId, status: 'active' }, attributes: ['user_id'] });
  const userIds = members.map(m => m.user_id);
  const existing = await Participant.findAll({ where: { conversation_id: conversationId, user_id: userIds } });
  const existingIds = new Set(existing.map(p => p.user_id));
  const createRows = userIds.filter(id => !existingIds.has(id)).map(user_id => ({ conversation_id: conversationId, user_id, unread_count: user_id === senderId ? 0 : 0 }));
  if (createRows.length) {
    await Participant.bulkCreate(createRows);
  }
}

function parseParticipantIds(raw) {
  if (raw == null) return [];
  let ids = [];
  if (Array.isArray(raw)) {
    ids = raw;
  } else if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) ids = parsed;
      else ids = raw.split(',');
    } catch {
      ids = raw.split(',');
    }
  } else if (typeof raw === 'number') {
    ids = [raw];
  }
  return Array.from(new Set(ids
    .map(id => {
      if (id === null || id === undefined || id === '') return null;
      const parsed = Number(id);
      return Number.isNaN(parsed) ? null : parsed;
    })
    .filter(id => id !== null)));
}

async function findConversationIdsByParticipantIds(participantIds) {
  const sequelize = db.sequelize;
  const ids = participantIds.map(id => Number(id));
  if (!ids.length) return [];
  const rows = await sequelize.query(
    `SELECT cp.conversation_id AS conversation_id
     FROM chat_conversation_participants cp
     JOIN chat_conversations c ON c.id = cp.conversation_id AND c.type='direct'
     GROUP BY cp.conversation_id
     HAVING SUM(CASE WHEN cp.user_id IN (:ids) THEN 1 ELSE 0 END) = :count
        AND COUNT(*) = :count`,
    { replacements: { ids, count: ids.length }, type: sequelize.QueryTypes.SELECT }
  );
  return rows.map(r => Number(r.conversation_id)).filter(id => !Number.isNaN(id));
}

async function getCommunityConversation(req, res) {
  try {
    const userId = req.user.id;
    const communityId = parseInt(req.params.community_id, 10);
    if (Number.isNaN(communityId)) return res.status(400).json({ error: 'community_id geçersiz' });

    const CommunityMember = db.CommunityMember || require('../models/communityMember');
    const member = await CommunityMember.findOne({ where: { community_id: communityId, user_id: userId, status: 'active' } });
    if (!member) return res.status(403).json({ error: 'Topluluk üyesi değilsiniz.' });

    let conv = await db.ChatConversation.findOne({ where: { type: 'community', community_id: communityId } });
    if (!conv) {
      conv = await db.ChatConversation.create({ type: 'community', community_id: communityId, created_by: userId });
    }

    await ensureCommunityConversationParticipants(communityId, conv.id, userId);
    return res.json({ conversation: conv });
  } catch (err) {
    console.error('[chat] getCommunityConversation error', err);
    res.status(500).json({ error: 'Community konusması getirilemedi', detail: err.message });
  }
}

// Liste: kullanıcının konuşma listesi
exports.getCommunityConversation = getCommunityConversation;

exports.listConversations = async (req, res) => {
  try {
    const userId = req.user.id;
    const Participant = db.ChatConversationParticipant || require('../models/chatConversationParticipant');
    const Conversation = db.ChatConversation || require('../models/chatConversation');
    const Message = db.ChatMessage || require('../models/chatMessage');

    const requestedParticipantIds = parseParticipantIds(req.query.participant_ids || req.query.participants);
    if (requestedParticipantIds.length > 0 && !requestedParticipantIds.includes(userId)) {
      return res.status(400).json({ error: 'participant_ids içinde kendi user_id\'niz bulunmalıdır' });
    }

    const parts = await Participant.findAll({ where: { user_id: userId } });
    const directConvIds = parts.map(p => p.conversation_id);

    const activeCommunityIds = await getActiveCommunityIds(userId);
    const communityConvs = activeCommunityIds.length > 0
      ? await Conversation.findAll({ where: { type: 'community', community_id: activeCommunityIds } })
      : [];

    let convIds;
    if (requestedParticipantIds.length > 0) {
      const matchingConvIds = await findConversationIdsByParticipantIds(requestedParticipantIds);
      convIds = new Set(matchingConvIds);
    } else {
      convIds = new Set(directConvIds);
      communityConvs.forEach(c => convIds.add(c.id));
    }

    if (!convIds.size) return res.json([]);

    const convs = await Conversation.findAll({ where: { id: Array.from(convIds) }, order: [['last_message_at', 'DESC']] });

    // Tüm konuşma katılımcılarını tek sorguda al
    const allParts = await Participant.findAll({ where: { conversation_id: Array.from(convIds) } });

    const result = await Promise.all(convs.map(async (c) => {
      const p = parts.find(x => String(x.conversation_id) === String(c.id));
      const lastMessage = await Message.findOne({ where: { conversation_id: c.id }, order: [['created_at', 'DESC']] });
      const unread_count = p ? p.unread_count : 0;
      const convJson = (c && typeof c.toJSON === 'function') ? c.toJSON() : c;
      convJson.community_id = convJson.community_id != null ? convJson.community_id : null;

      const partsForConv = allParts.filter(x => String(x.conversation_id) === String(convJson.id));
      const participant_ids = partsForConv.map(pp => pp.user_id);
      let other_user_id = null;
      if (convJson.type === 'direct') {
        other_user_id = participant_ids.find(id => Number(id) !== Number(userId)) || null;
      }

      return {
        conversation: convJson,
        lastMessage,
        unread_count,
        participant_ids,
        other_user_id,
        conversation_type: convJson.type || null,
        community_id: convJson.community_id != null ? convJson.community_id : null,
      };
    }));

    res.json(result);
  } catch (err) {
    console.error('[chat] listConversations error', err);
    res.status(500).json({ error: 'Konuşmalar alınamadı', detail: err.message });
  }
};

// Mesajları getir
exports.getMessages = async (req, res) => {
  try {
    const userId = req.user.id;
    const conversationId = req.params.id;
    if (!conversationId) return res.status(400).json({ error: 'conversation id (route param) gerekli' });
    const convIdNum = parseInt(conversationId, 10);
    if (Number.isNaN(convIdNum)) return res.status(400).json({ error: 'conversation id geçersiz' });
    const limit = parseInt(req.query.limit || '50', 10);
    const before = req.query.before;

    const Participant = db.ChatConversationParticipant || require('../models/chatConversationParticipant');
    let part = await Participant.findOne({ where: { conversation_id: convIdNum, user_id: userId } });
      if (!part) {
      const conv = await db.ChatConversation.findByPk(convIdNum);
      if (!conv) return res.status(404).json({ error: 'Konuşma bulunamadı' });
      if (conv.community_id != null) {
        const CommunityMember = db.CommunityMember || require('../models/communityMember');
        const member = await CommunityMember.findOne({ where: { community_id: conv.community_id, user_id: userId, status: 'active' } });
        if (!member) return res.status(403).json({ error: 'Konuşmaya erişim yok' });
        part = await Participant.create({ conversation_id: convIdNum, user_id: userId, unread_count: 0 });
      } else {
        return res.status(403).json({ error: 'Konuşmaya erişim yok' });
      }
    }

    const where = { conversation_id: convIdNum };
    if (before) where.created_at = { [Op.lt]: new Date(before) };

    const messages = await db.ChatMessage.findAll({ where, order: [['created_at', 'DESC']], limit });
    // kronolojik sıraya çevir
    res.json(messages.reverse());
  } catch (err) {
    console.error('[chat] getMessages error', err);
    res.status(500).json({ error: 'Mesajlar alınamadı', detail: err.message });
  }
};

// Mesaj gönderme (conversation_id veya recipient_id/community_id ile)
exports.postMessage = async (req, res) => {
  try {
    const senderId = req.user.id;
    const { conversation_id, recipient_id, actualRecipientId: actualRecipientIdInput, community_id, participant_ids, participants, text, attachments, meta } = req.body || {};
    const requestedParticipantIds = parseParticipantIds(participant_ids || participants);

    // Premium kontrol (kullanıcı modeli mantığını yeniden kullanıyoruz)
    const User = db.User || require('../models/user');
    const sender = await User.findByPk(senderId);
    const now = new Date();
    const isPremium = !!(sender.offline_enabled || (sender.subscription_is_active && sender.subscription_expires_at && sender.subscription_expires_at > now));
    if (!isPremium) return res.status(403).json({ error: 'Bu özellik sadece premium kullanıcılar için.' });

    const sequelize = db.sequelize;
    let convId = conversation_id;
    let actualRecipientId = recipient_id || actualRecipientIdInput;

    if (!convId) {
      if (requestedParticipantIds.length > 0) {
        const normalizedIds = requestedParticipantIds.includes(senderId)
          ? requestedParticipantIds
          : [senderId, ...requestedParticipantIds];
        if (normalizedIds.length !== 2) {
          return res.status(400).json({ error: 'participant_ids ile sadece iki katılımcı içeren doğrudan sohbet aranabilir.' });
        }
        if (!normalizedIds.includes(senderId)) {
          return res.status(400).json({ error: 'participant_ids içinde kendi user_id\'niz bulunmalıdır' });
        }

        const otherUserId = normalizedIds.find(id => id !== senderId);
        actualRecipientId = actualRecipientId || otherUserId;

        const Friendship = db.Friendship || require('../models/friendship');
        const friend = await Friendship.findOne({ where: { status: 'accepted', [Op.or]: [{ user_id: senderId, friend_id: otherUserId }, { user_id: otherUserId, friend_id: senderId }] } });
        if (!friend) return res.status(403).json({ error: 'Sadece arkadaşlara mesaj atabilirsiniz.' });

        const existingIds = await findConversationIdsByParticipantIds(normalizedIds);
        if (existingIds.length > 0) {
          convId = existingIds[0];
        } else {
          const created = await sequelize.transaction(async (t) => {
            const newConv = await db.ChatConversation.create({ type: 'direct', created_by: senderId }, { transaction: t });
            await db.ChatConversationParticipant.create({ conversation_id: newConv.id, user_id: senderId }, { transaction: t });
            await db.ChatConversationParticipant.create({ conversation_id: newConv.id, user_id: otherUserId }, { transaction: t });
            return newConv;
          });
          convId = created.id;
        }
      } else if (recipient_id || actualRecipientIdInput) {
        const targetRecipientId = recipient_id || actualRecipientIdInput;
        // arkadaş kontrolü
        const Friendship = db.Friendship || require('../models/friendship');
        const friend = await Friendship.findOne({ where: { status: 'accepted', [Op.or]: [{ user_id: senderId, friend_id: targetRecipientId }, { user_id: targetRecipientId, friend_id: senderId }] } });
        if (!friend) return res.status(403).json({ error: 'Sadece arkadaşlara mesaj atabilirsiniz.' });

        // var olan DM konuşmasını bul
        const existing = await sequelize.query(
          `SELECT c.id FROM chat_conversations c
           JOIN chat_conversation_participants p ON p.conversation_id = c.id
           WHERE c.type='direct' AND p.user_id IN (:a, :b)
           GROUP BY c.id HAVING COUNT(DISTINCT p.user_id)=2
           LIMIT 1`,
          { replacements: { a: senderId, b: targetRecipientId }, type: sequelize.QueryTypes.SELECT }
        );
        if (existing && existing.length > 0) {
          convId = existing[0].id;
        } else {
          // konuşma oluştur
          const created = await sequelize.transaction(async (t) => {
            const newConv = await db.ChatConversation.create({ type: 'direct', created_by: senderId }, { transaction: t });
            await db.ChatConversationParticipant.create({ conversation_id: newConv.id, user_id: senderId }, { transaction: t });
            await db.ChatConversationParticipant.create({ conversation_id: newConv.id, user_id: targetRecipientId }, { transaction: t });
            return newConv;
          });
          convId = created.id;
        }
      } else if (community_id) {
        const CommunityMember = db.CommunityMember || require('../models/communityMember');
        const member = await CommunityMember.findOne({ where: { community_id, user_id: senderId, status: 'active' } });
        if (!member) return res.status(403).json({ error: 'Topluluk üyesi değilsiniz.' });

        let conv = await db.ChatConversation.findOne({ where: { type: 'community', community_id } });
        if (!conv) conv = await db.ChatConversation.create({ type: 'community', community_id, created_by: senderId });
        convId = conv.id;
        await ensureCommunityConversationParticipants(community_id, convId, senderId);
      } else {
        return res.status(400).json({ error: 'conversation_id veya recipient_id veya community_id gerekli' });
      }
    }

    const conversation = await db.ChatConversation.findByPk(convId);

    // mesaj oluştur
    const createdMessage = await db.ChatMessage.create({ conversation_id: convId, sender_id: senderId, recipient_id: actualRecipientId || null, community_id: community_id || null, text, attachments: attachments || null, meta: meta || null });

    // conversation güncelle
    await db.ChatConversation.update({ last_message_at: new Date() }, { where: { id: convId } });

    // unread sayısını arttır
    if (community_id) {
      const conv = await db.ChatConversation.findByPk(convId);
      if (conv && conv.community_id != null) {
        await ensureCommunityConversationParticipants(community_id, convId, senderId);
      }
    }
    await db.ChatConversationParticipant.increment('unread_count', { by: 1, where: { conversation_id: convId, user_id: { [Op.ne]: senderId } } });

    // WebSocket ile broadcast ve control mesajı işleme
    try {
      const chatSocket = require('../utils/chatSocket');
      // Oluşan mesajı yayınla — conversation_id ve community_id ile birlikte gönder
      const broadcastPayload = { type: 'message', conversation_id: convId, community_id: community_id != null ? community_id : null, payload: createdMessage };
      chatSocket.broadcastToConversation(convId, broadcastPayload);

      // Eğer control tipi bir meta gelmişse, hedef mesaj üzerinde işlem yap
      // Desteklenen control yapıları için esnek alan isimleri kontrol ediliyor
      if (meta && (meta.type === 'control' || meta.action === 'control' || (meta.control && typeof meta.control === 'object'))) {
        try {
          const ctrl = meta.control && typeof meta.control === 'object' ? meta.control : meta;
          const action = ctrl.action || ctrl.type || meta.action;
          const targetId = ctrl.target_message_id || ctrl.targetMessageId || ctrl.message_id || ctrl.target_id || ctrl.targetId || meta.target_message_id || meta.message_id;

          if (targetId && (action === 'delete' || action === 'delete_message' || action === 'remove')) {
            const targetMsg = await db.ChatMessage.findByPk(targetId);
            if (targetMsg) {
              if (String(targetMsg.conversation_id) !== String(convId)) {
                console.warn('[chat] control target belongs to different conversation', targetId, targetMsg.conversation_id, convId);
              } else {
                targetMsg.is_deleted = true;
                targetMsg.updated_at = new Date();
                await targetMsg.save();
                // Güncellenen hedef mesajı yayınla (conversation_id + community_id)
                chatSocket.broadcastToConversation(convId, { type: 'message_updated', conversation_id: convId, community_id: community_id != null ? community_id : null, payload: targetMsg });
              }
            } else {
              console.warn('[chat] control target message not found', targetId);
            }
          }
        } catch (innerErr) {
          console.warn('[chat] control message handling failed', innerErr && innerErr.message);
        }
      }
    } catch (e) {
      console.warn('[chat] broadcast fail', e && e.message);
    }

    res.status(201).json({ message: createdMessage, conversation_id: convId, conversation: conversation ? conversation.toJSON() : { id: convId }, community_id: community_id != null ? community_id : null });
  } catch (err) {
    console.error('[chat] postMessage error', err);
    res.status(500).json({ error: 'Mesaj gönderilemedi', detail: err.message });
  }
};

// Konuşma katılımcılarını getir (frontend için)
exports.getParticipants = async (req, res) => {
  try {
    const userId = req.user.id;
    const conversationId = req.params.id;
    if (!conversationId) return res.status(400).json({ error: 'conversation id gerekli' });
    const convIdNum = parseInt(conversationId, 10);
    if (Number.isNaN(convIdNum)) return res.status(400).json({ error: 'conversation id geçersiz' });

    const Conversation = db.ChatConversation || require('../models/chatConversation');
    const Participant = db.ChatConversationParticipant || require('../models/chatConversationParticipant');

    const conv = await Conversation.findByPk(convIdNum);
    if (!conv) return res.status(404).json({ error: 'Konuşma bulunamadı' });

    // Erişim kontrolü: topluluk konuşmasıysa topluluk üyesi olmalı, direct ise katılımcı olmalı
    if (conv.community_id != null) {
      const CommunityMember = db.CommunityMember || require('../models/communityMember');
      const member = await CommunityMember.findOne({ where: { community_id: conv.community_id, user_id: userId, status: 'active' } });
      if (!member) return res.status(403).json({ error: 'Konuşmaya erişim yok' });
    } else {
      const mePart = await Participant.findOne({ where: { conversation_id: convIdNum, user_id: userId } });
      if (!mePart) return res.status(403).json({ error: 'Konuşmaya erişim yok' });
    }

    const parts = await Participant.findAll({ where: { conversation_id: convIdNum } });
    const userIds = parts.map(p => p.user_id);
    const users = userIds.length ? await db.User.findAll({ where: { id: userIds }, attributes: ['id', 'username', 'name', 'avatar_url'] }) : [];
    const userMap = new Map((users || []).map(u => [u.id, u && typeof u.toJSON === 'function' ? u.toJSON() : u]));

    const result = parts.map((p) => {
      const pJson = p && typeof p.toJSON === 'function' ? p.toJSON() : p;
      const uid = pJson.user_id;
      const u = userMap.get(uid) || { id: uid };
      return {
        user: {
          id: u.id,
          username: u.username || null,
          name: u.name || null,
          avatar_url: u.avatar_url || null
        },
        user_id: uid,
        role: pJson.role || null,
        last_read_message_id: pJson.last_read_message_id || null,
        unread_count: pJson.unread_count || 0,
        joined_at: pJson.joined_at || null,
        is_muted: pJson.is_muted || false,
        is_self: Number(uid) === Number(userId)
      };
    });

    res.json({ participants: result });
  } catch (err) {
    console.error('[chat] getParticipants error', err);
    res.status(500).json({ error: 'Katılımcılar alınamadı', detail: err.message });
  }
};

// Okundu olarak işaretle
exports.markRead = async (req, res) => {
  try {
    const userId = req.user.id;
    const conversation_id = req.params.id;
    const { message_id } = req.body || {};
    if (!message_id) return res.status(400).json({ error: 'message_id gerekli' });

    const updated = await db.ChatConversationParticipant.update({ last_read_message_id: message_id, unread_count: 0 }, { where: { conversation_id, user_id: userId } });
    if (!updated || updated[0] === 0) {
      const conv = await db.ChatConversation.findByPk(conversation_id);
      if (conv && conv.community_id != null) {
        const CommunityMember = db.CommunityMember || require('../models/communityMember');
        const member = await CommunityMember.findOne({ where: { community_id: conv.community_id, user_id: userId, status: 'active' } });
        if (member) {
          await db.ChatConversationParticipant.create({ conversation_id, user_id: userId, last_read_message_id: message_id, unread_count: 0 });
        } else {
          return res.status(403).json({ error: 'Konuşmaya erişim yok' });
        }
      } else {
        return res.status(403).json({ error: 'Konuşmaya erişim yok' });
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[chat] markRead error', err);
    res.status(500).json({ error: 'Okuma işareti güncellenemedi', detail: err.message });
  }
};
