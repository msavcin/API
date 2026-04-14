const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const db = require('../models');

const JWT_SECRET = process.env.JWT_SECRET || 'demo_secret_key';
let wss = null;
const clientsByUser = new Map();

function init(server) {
  wss = new WebSocket.Server({ server, path: '/node/chat/socket' });

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'auth') {
          const token = msg.token;
          if (!token) { ws.send(JSON.stringify({ type: 'auth', ok: false, error: 'token gerekli' })); ws.close(); return; }
          jwt.verify(token, JWT_SECRET, (err, decoded) => {
            if (err) { ws.send(JSON.stringify({ type: 'auth', ok: false, error: 'Geçersiz token' })); ws.close(); return; }
            ws.userId = decoded.id;
            clientsByUser.set(decoded.id, ws);
            ws.send(JSON.stringify({ type: 'auth', ok: true, userId: decoded.id }));
          });
          return;
        }
        if (msg.type === 'ping') return ws.send(JSON.stringify({ type: 'pong' }));
        // Diğer mesaj tipleri (ör: client->server message) uygulamaya göre genişletilebilir
      } catch (e) {
        console.warn('[WS] parse error', e && e.message);
      }
    });

    ws.on('close', () => {
      if (ws.userId) clientsByUser.delete(ws.userId);
    });
  });

  // health ping
  const interval = setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping(() => {});
    });
  }, 30000);

  wss.on('close', () => clearInterval(interval));
}

function broadcastToUser(userId, payload) {
  const socket = clientsByUser.get(userId);
  if (!socket) return false;
  try {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
    return true;
  } catch (e) {
    console.warn('[WS] send error', e && e.message);
    return false;
  }
}

function broadcastToConversation(conversationId, payload) {
  // DB'den katılımcıları çekip kullanıcılara gönder
  db.ChatConversationParticipant.findAll({ where: { conversation_id: conversationId } }).then(parts => {
    parts.forEach(p => {
      if (p.user_id) broadcastToUser(p.user_id, payload);
    });
  }).catch(err => console.warn('[WS] broadcast conversation error', err && err.message));
}

module.exports = { init, broadcastToUser, broadcastToConversation };
