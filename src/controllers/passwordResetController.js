const db = require('../models');
const User = db.User || require('../models/user');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');

// Şifre sıfırlama isteği: e-posta ile token gönder
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'E-posta zorunlu' });
  const user = await User.findOne({ where: { email } });
  if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  // Token üret
  const token = crypto.randomBytes(32).toString('hex');
  const expires_at = new Date(Date.now() + 1000 * 60 * 60 * 3.5); // 3 saat 30 dakika geçerli
  // Tokenı veritabanına kaydet
  await db.PasswordReset.create({ user_id: user.id, token, expires_at });
  // E-posta gönder
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
  });
  // Web linki ile yönlendirme (universal link yaklaşımı)
  // Web sayfası deep link desteği ile uygulamayı açar
  const webUrl = `https://www.kampdefterim.com/reset-password.html?token=${token}`;
  const deepLinkUrl = `kampdefterim://reset-password?token=${token}`;
  
  console.log('[PASSWORD_RESET][MAIL][webUrl]', webUrl);
  console.log('[PASSWORD_RESET][MAIL][deepLinkUrl]', deepLinkUrl);
  
  await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to: email,
    subject: 'Şifre Sıfırlama Talebi',
    html: `
      <p>Şifrenizi sıfırlamak için aşağıdaki linke tıklayın:</p>
      <p><a href="${webUrl}">Şifremi Sıfırla</a></p>
      <p>Bu link 30 dakika geçerlidir.</p>
      <br>
      <p style="color: #666; font-size: 12px;">Mobil uygulamamız yüklüyse otomatik olarak açılacaktır.</p>
    `
  });
  res.json({ success: true });
};

// Şifre sıfırlama: token ile yeni şifre belirle
exports.resetPassword = async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token ve yeni şifre zorunlu' });
  const record = await db.PasswordReset.findOne({ where: { token } });
  if (!record || record.expires_at < new Date()) {
    return res.status(400).json({ error: 'Token geçersiz veya süresi dolmuş' });
  }
  const user = await User.findByPk(record.user_id);
  if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const hash = await bcrypt.hash(password, 10);
  await user.update({ password_hash: hash });
  await record.destroy(); // Tokenı sil
  res.json({ success: true });
};
