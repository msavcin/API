const db = require('../models');
const EmailVerificationCode = db.EmailVerificationCode || require('../models/emailVerificationCode');
const { Op } = require('sequelize');
const nodemailer = require('nodemailer');

// 6 haneli kod üret
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// E-posta gönder (örnek, gerçek SMTP ayarları ile değiştirilmeli)
async function sendMail(email, code) {
  // Geliştirme/test için console.log ile göster
  // console.log(`[EMAIL] Doğrulama kodu: ${code} -> ${email}`);
  // Gmail SMTP ile gönderim
  let transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER || 'gmailadresiniz@gmail.com', // .env ile gizleyin
      pass: process.env.GMAIL_PASS || 'uygulama_şifresi'
    }
  });
  await transporter.sendMail({
    from: process.env.GMAIL_USER || 'gmailadresiniz@gmail.com',
    to: email,
    subject: 'E-posta Doğrulama Kodu',
    text: `Doğrulama kodunuz: ${code}`
  });
}

// POST /node/users/send-verification-code
exports.sendVerificationCode = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'E-posta zorunlu' });
  const code = generateCode();
  const expiresAt = new Date(Date.now() + 240 * 60 * 1000); // 15 dakika sonrası
  // Son 15 dakikada kod var mı?
  const existing = await EmailVerificationCode.findOne({ where: { email } });
  if (existing && existing.expires_at > new Date()) {
    // Kodun süresi geçmediyse güncelle
    await existing.update({ code, expires_at: expiresAt });
  } else if (existing) {
    // Kodun süresi geçtiyse yeni kodla güncelle
    await existing.update({ code, expires_at: expiresAt });
  } else {
    await EmailVerificationCode.create({ email, code, expires_at: expiresAt });
  }
  await sendMail(email, code);
  res.json({ success: true });
};

// POST /node/users/verify-code
exports.verifyCode = async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'E-posta ve kod zorunlu' });
  const record = await EmailVerificationCode.findOne({ where: { email, code } });
  if (!record) return res.status(400).json({ error: 'Kod hatalı' });
  if (record.expires_at < new Date()) return res.status(400).json({ error: 'Kodun süresi dolmuş' });
  // Doğrulandı olarak işaretle (opsiyonel: yeni bir alan eklenebilir, burada sadece kodun varlığı kontrol ediliyor)
  res.json({ success: true });
};
