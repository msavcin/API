/**
 * Admin Settings Controller
 * Sistem genelinde admin ayarlarını yönetir
 */

const db = require('../models');

const PUBLIC_APP_SETTING_DEFAULTS = {
  non_premium_camping_area_limit: '10',
  app_latest_version: '',
  app_min_supported_version: '',
  app_update_required: 'false',
  app_update_message: 'Kamp Defterim\'in yeni bir sürümü hazır. Daha iyi performans ve yeni özellikler için güncelleyin.',
  app_update_android_url: 'https://play.google.com/store/apps/details?id=com.spondylus.boltexponativewind',
  app_update_ios_url: 'https://apps.apple.com/tr/app/kamp-defterim/id6759046939?l=tr',
};

/**
 * GET /node/admin/app-config
 * Mobil uygulamanın herkese açık/oturumlu çalışma ayarlarını getirir.
 * Hassas admin ayarları dönmez; sadece client'ın runtime'da ihtiyaç duyduğu değerler.
 */
exports.getAppConfig = async (req, res) => {
  try {
    const keys = Object.keys(PUBLIC_APP_SETTING_DEFAULTS);
    const settings = await db.AppSetting.findAll({
      where: { key: keys },
      attributes: ['key', 'value']
    });

    const map = { ...PUBLIC_APP_SETTING_DEFAULTS };
    settings.forEach((setting) => {
      map[setting.key] = setting.value;
    });

    const nonPremiumLimit = parseInt(map.non_premium_camping_area_limit || '10', 10);

    res.json({
      settings: {
        non_premium_camping_area_limit: Number.isFinite(nonPremiumLimit) && nonPremiumLimit >= 0
          ? nonPremiumLimit
          : 10,
        app_latest_version: map.app_latest_version || '',
        app_min_supported_version: map.app_min_supported_version || '',
        app_update_required: map.app_update_required === 'true' || map.app_update_required === '1',
        app_update_message: map.app_update_message || PUBLIC_APP_SETTING_DEFAULTS.app_update_message,
        app_update_android_url: map.app_update_android_url || PUBLIC_APP_SETTING_DEFAULTS.app_update_android_url,
        app_update_ios_url: map.app_update_ios_url || PUBLIC_APP_SETTING_DEFAULTS.app_update_ios_url,
      }
    });
  } catch (error) {
    console.error('App config getirme hatası:', error);
    res.status(500).json({ error: 'Uygulama ayarları getirilemedi' });
  }
};

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
