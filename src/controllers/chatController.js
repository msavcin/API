const db = require('../models');
const { Op } = require('sequelize');

// Liste: kullanıcının konuşma listesi
exports.listConversations = async (req, res) => {
  try {
    const userId = req.user.id;
    const Participant = db.ChatConversationParticipant || require('../models/chatConversationParticipant');
    const Conversation = db.ChatConversation || require('../models/chatConversation');
    const Message = db.ChatMessage || require('../models/chatMessage');

    const parts = await Participant.findAll({ where: { user_id: userId } });
    const convIds = parts.map(p => p.conversation_id);
    if (!convIds.length) return res.json([]);

    const convs = await Conversation.findAll({ where: { id: convIds }, order: [['last_message_at', 'DESC']] });

    const result = await Promise.all(convs.map(async (c) => {
      const p = parts.find(x => String(x.conversation_id) === String(c.id));
      const lastMessage = await Message.findOne({ where: { conversation_id: c.id }, order: [['created_at', 'DESC']] });
      return {
        conversation: c,
        lastMessage,
        unread_count: p ? p.unread_count : 0
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
    const part = await Participant.findOne({ where: { conversation_id: convIdNum, user_id: userId } });
    if (!part) return res.status(403).json({ error: 'Konuşmaya erişim yok' });

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
    const { conversation_id, recipient_id, community_id, text, attachments, meta } = req.body || {};

    // Premium kontrol (kullanıcı modeli mantığını yeniden kullanıyoruz)
    const User = db.User || require('../models/user');
    const sender = await User.findByPk(senderId);
    const now = new Date();
    const isPremium = !!(sender.offline_enabled || (sender.subscription_is_active && sender.subscription_expires_at && sender.subscription_expires_at > now));
    if (!isPremium) return res.status(403).json({ error: 'Bu özellik sadece premium kullanıcılar için.' });

    const sequelize = db.sequelize;
    let convId = conversation_id;

    if (!convId) {
      if (recipient_id) {
        // arkadaş kontrolü
        const Friendship = db.Friendship || require('../models/friendship');
        const friend = await Friendship.findOne({ where: { status: 'accepted', [Op.or]: [{ user_id: senderId, friend_id: recipient_id }, { user_id: recipient_id, friend_id: senderId }] } });
        if (!friend) return res.status(403).json({ error: 'Sadece arkadaşlara mesaj atabilirsiniz.' });

        // var olan DM konuşmasını bul
        const existing = await sequelize.query(
          `SELECT c.id FROM chat_conversations c
           JOIN chat_conversation_participants p ON p.conversation_id = c.id
           WHERE c.type='direct' AND p.user_id IN (:a, :b)
           GROUP BY c.id HAVING COUNT(DISTINCT p.user_id)=2
           LIMIT 1`,
          { replacements: { a: senderId, b: recipient_id }, type: sequelize.QueryTypes.SELECT }
        );
        if (existing && existing.length > 0) {
          convId = existing[0].id;
        } else {
          // konuşma oluştur
          const created = await sequelize.transaction(async (t) => {
            const newConv = await db.ChatConversation.create({ type: 'direct', created_by: senderId }, { transaction: t });
            await db.ChatConversationParticipant.create({ conversation_id: newConv.id, user_id: senderId }, { transaction: t });
            await db.ChatConversationParticipant.create({ conversation_id: newConv.id, user_id: recipient_id }, { transaction: t });
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
      } else {
        return res.status(400).json({ error: 'conversation_id veya recipient_id veya community_id gerekli' });
      }
    }

    // mesaj oluştur
    const createdMessage = await db.ChatMessage.create({ conversation_id: convId, sender_id: senderId, recipient_id: recipient_id || null, community_id: community_id || null, text, attachments: attachments || null, meta: meta || null });

    // conversation güncelle
    await db.ChatConversation.update({ last_message_at: new Date() }, { where: { id: convId } });

    // unread sayısını arttır
    await db.ChatConversationParticipant.increment('unread_count', { by: 1, where: { conversation_id: convId, user_id: { [Op.ne]: senderId } } });

    // WebSocket ile broadcast ve control mesajı işleme
    try {
      const chatSocket = require('../utils/chatSocket');
      // Oluşan mesajı yayınla
      chatSocket.broadcastToConversation(convId, { type: 'message', payload: createdMessage });

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
                // Güncellenen hedef mesajı yayınla
                chatSocket.broadcastToConversation(convId, { type: 'message_updated', payload: targetMsg });
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

    res.status(201).json(createdMessage);
  } catch (err) {
    console.error('[chat] postMessage error', err);
    res.status(500).json({ error: 'Mesaj gönderilemedi', detail: err.message });
  }
};

// Okundu olarak işaretle
exports.markRead = async (req, res) => {
  try {
    const userId = req.user.id;
    const conversation_id = req.params.id;
    const { message_id } = req.body || {};
    if (!message_id) return res.status(400).json({ error: 'message_id gerekli' });

    await db.ChatConversationParticipant.update({ last_read_message_id: message_id, unread_count: 0 }, { where: { conversation_id, user_id: userId } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[chat] markRead error', err);
    res.status(500).json({ error: 'Okuma işareti güncellenemedi', detail: err.message });
  }
};
