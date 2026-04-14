const express = require('express');
const router = express.Router();
const { register, login, getMe, updateMe, updateEmail, refreshToken, createUser, listUsers, getAvatarUploadUrl, patchMe, deleteMe, aiEvalStatus } = require('../controllers/userController');
const emailVerificationController = require('../controllers/emailVerificationController');
const passwordResetController = require('../controllers/passwordResetController');
// E-posta doğrulama kodu gönder
router.post('/send-verification-code', emailVerificationController.sendVerificationCode);
// E-posta doğrulama kodu kontrol
router.post('/verify-code', emailVerificationController.verifyCode);
// Kullanıcı ekle (admin veya sistem için, register'dan farklı)
router.post('/', createUser);
// Kullanıcı listele
router.get('/', listUsers);
const { authMiddleware } = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);
router.get('/me', authMiddleware, getMe);
// Kullanıcının o gün için kalan AI değerlendirme hakkı (tüketmeden sorgulama)
router.get('/me/ai-eval-status', authMiddleware, aiEvalStatus);
router.put('/update-email', authMiddleware, updateEmail);
router.put('/me', authMiddleware, updateMe);
// Avatar upload için presigned URL
router.post('/avatar/upload-url', authMiddleware, getAvatarUploadUrl);
// Kendi profilini PATCH ile güncelle
router.patch('/me', authMiddleware, patchMe);
// Kendi hesabını sil (tüm ilgili verilerle birlikte)
router.delete('/me', authMiddleware, deleteMe);
// Refresh token endpointi (güncel rol ile yeni JWT)
router.post('/refresh-token', authMiddleware, refreshToken);

module.exports = router;
// Şifre sıfırlama isteği
router.post('/forgot-password', passwordResetController.forgotPassword);
// Şifre sıfırlama (token ile yeni şifre)
router.post('/reset-password', passwordResetController.resetPassword);
