/**
 * Admin Settings Controller
 * Sistem genelinde admin ayarlarını yönetir
 */

const db = require('../models');

/**
 * GET /node/admin/settings
 * Tüm admin ayarlarını getirir (sadece superadmin)
 */
exports.getAllSettings = async (req, res) => {
  try {
    // Auth middleware'den gelen user
    if (req.user?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Yetkisiz erişim' });
    }

    const settings = await db.AppSetting.findAll({
      order: [['key', 'ASC']],
      attributes: ['key', 'value', 'description', 'updated_at', 'updated_by']
    });

    res.json({ settings });
  } catch (error) {
    console.error('Admin settings getirme hatası:', error);
    res.status(500).json({ error: 'Ayarlar getirilemedi' });
  }
};

/**
 * GET /node/admin/settings/:key
 * Belirli bir admin ayarını getirir (sadece superadmin)
 */
exports.getSetting = async (req, res) => {
  try {
    if (req.user?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Yetkisiz erişim' });
    }

    const { key } = req.params;

    const setting = await db.AppSetting.findOne({
      where: { key },
      attributes: ['key', 'value', 'description', 'updated_at', 'updated_by']
    });

    if (!setting) {
      return res.status(404).json({ error: 'Ayar bulunamadı' });
    }

    res.json({ setting });
  } catch (error) {
    console.error('Admin setting getirme hatası:', error);
    res.status(500).json({ error: 'Ayar getirilemedi' });
  }
};

/**
 * PUT /node/admin/settings/:key
 * Bir admin ayarını günceller (sadece superadmin)
 */
exports.updateSetting = async (req, res) => {
  try {
    if (req.user?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Yetkisiz erişim' });
    }

    const { key } = req.params;
    const { value } = req.body;

    if (value === undefined || value === null) {
      return res.status(400).json({ error: 'value parametresi gerekli' });
    }

    // Ayarın varlığını kontrol et
    const setting = await db.AppSetting.findOne({ where: { key } });

    if (!setting) {
      return res.status(404).json({ error: 'Ayar bulunamadı' });
    }

    // Ayarı güncelle
    await setting.update({
      value: String(value),
      updated_by: req.user.id,
      updated_at: new Date()
    });

    res.json({ 
      success: true,
      setting: {
        key: setting.key,
        value: setting.value,
        updated_at: setting.updated_at
      }
    });
  } catch (error) {
    console.error('Admin setting güncelleme hatası:', error);
    res.status(500).json({ error: 'Ayar güncellenemedi' });
  }
};

/**
 * POST /node/admin/settings
 * Yeni bir admin ayarı oluşturur (sadece superadmin)
 */
exports.createSetting = async (req, res) => {
  try {
    if (req.user?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Yetkisiz erişim' });
    }

    const { key, value, description } = req.body;

    if (!key || value === undefined) {
      return res.status(400).json({ error: 'key ve value parametreleri gerekli' });
    }

    // Ayar zaten var mı kontrol et
    const existingSetting = await db.AppSetting.findOne({ where: { key } });

    if (existingSetting) {
      return res.status(409).json({ error: 'Bu ayar zaten mevcut' });
    }

    // Yeni ayar oluştur
    const newSetting = await db.AppSetting.create({
      key,
      value: String(value),
      description: description || '',
      updated_by: req.user.id
    });

    res.status(201).json({ 
      success: true,
      setting: {
        key: newSetting.key,
        value: newSetting.value,
        description: newSetting.description,
        created_at: newSetting.created_at
      }
    });
  } catch (error) {
    console.error('Admin setting oluşturma hatası:', error);
    res.status(500).json({ error: 'Ayar oluşturulamadı' });
  }
};

/**
 * DELETE /node/admin/settings/:key
 * Bir admin ayarını siler (sadece superadmin)
 */
exports.deleteSetting = async (req, res) => {
  try {
    if (req.user?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Yetkisiz erişim' });
    }

    const { key } = req.params;

    const deleted = await db.AppSetting.destroy({
      where: { key }
    });

    if (!deleted) {
      return res.status(404).json({ error: 'Ayar bulunamadı' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Admin setting silme hatası:', error);
    res.status(500).json({ error: 'Ayar silinemedi' });
  }
};
