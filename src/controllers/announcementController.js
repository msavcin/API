// Duyurudan etkinlik fotoğrafı sil
exports.removeEventPhoto = async (req, res) => {
  const { announcement_id, photo_url } = req.body;
  if (!announcement_id || !photo_url) {
    return res.status(400).json({ error: 'announcement_id ve photo_url zorunlu' });
  }
  const announcement = await Announcement.findByPk(announcement_id);
  if (!announcement) return res.status(404).json({ error: 'Duyuru bulunamadı' });
  const photos = Array.isArray(announcement.event_photos) ? announcement.event_photos : [];
  const updatedPhotos = photos.filter(url => url !== photo_url);
  await announcement.update({ event_photos: updatedPhotos });
  res.json({ success: true, event_photos: updatedPhotos });
};
// Duyuruya etkinlik fotoğrafı yükle
const s3 = require('../utils/s3');
const path = require('path');
exports.uploadEventPhoto = async (req, res) => {
  console.log('[UPLOAD_EVENT_PHOTO] Fonksiyon çağrıldı');
  console.log('[UPLOAD_EVENT_PHOTO][req.body]', req.body, 'typeof:', typeof req.body);
  console.log('[UPLOAD_EVENT_PHOTO][req.user]', req.user);
  try {
    // Multer ile gelen body bazen string olabilir, parse etmeye çalış
    let community_id = req.body.community_id;
    if (typeof req.body === 'string') {
      try {
        const parsedBody = JSON.parse(req.body);
        community_id = parsedBody.community_id || community_id;
        console.log('[UPLOAD_EVENT_PHOTO][PARSED_BODY]', parsedBody);
      } catch (e) {
        console.log('[UPLOAD_EVENT_PHOTO][BODY_PARSE_ERROR]', e);
      }
    }
    // Diğer kaynaklardan da al
    community_id = community_id
      || (req.user && req.user.community_id)
      || req.query.community_id
      || req.headers['community_id'];
    console.log('[UPLOAD_EVENT_PHOTO][COMMUNITY_ID]', community_id, 'typeof:', typeof community_id, 'body:', req.body.community_id, 'user:', req.user && req.user.community_id, 'query:', req.query.community_id, 'headers:', req.headers['community_id']);
    if (!community_id) {
      return res.status(400).json({
        error: 'community_id eksik (JWT, body, param veya header ile iletilmeli)',
        body: req.body,
        user: req.user,
        query: req.query,
        headers: req.headers
      });
    }
    // upload.any() ile dosya req.files dizisinde gelir
    const file = req.file || (req.files && req.files[0]);
    if (!file) {
      return res.status(400).json({ error: 'Dosya gerekli (file alanı ile gönderilmeli)' });
    }
    const fileExt = path.extname(file.originalname) || '.jpg';
    const fileName = `announcement_event_photos/${Date.now()}_${Math.random().toString(36).slice(2)}${fileExt}`;
    const params = {
      Bucket: process.env.AWS_S3_BUCKET,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype
    };
    // S3'e gönderilen dosya ve parametreleri logla
    console.log('[S3][UPLOAD][ANNOUNCEMENT_EVENT_PHOTO][DEBUG] Gönderilen dosya:', {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      fileName,
      params: { ...params, Body: `[buffer:${file.buffer.length} bytes]` }
    });
    s3.upload(params, (err, data) => {
      if (err) {
        console.error('[S3][UPLOAD][ANNOUNCEMENT_EVENT_PHOTO][ERROR]', err);
        return res.status(500).json({ error: 'S3 upload hatası', detail: err.message });
      }
      console.log('[S3][UPLOAD][ANNOUNCEMENT_EVENT_PHOTO][SUCCESS]', data);
      res.json({ image_url: data.Location, key: data.Key, community_id });
    });
  } catch (err) {
    console.error('[S3][UPLOAD][ANNOUNCEMENT_EVENT_PHOTO][CATCH]', err);
    res.status(500).json({ error: 'Dosya yüklenemedi', detail: err.message });
  }
};
// Belirli bir valilik_id'ye ait duyuruları listele
exports.listByValilikId = async (req, res) => {
  const valilik_id = Number(req.params.valilik_id);
  if (!valilik_id) {
    return res.status(400).json({ error: 'valilik_id eksik veya geçersiz' });
  }
  const announcements = await Announcement.findAll({ where: { valilik_id, aktif: true } });
  res.json(announcements);
};
const db = require('../models');
const Announcement = db.Announcement || require('../models/announcement');

// Tüm duyuruları listele (opsiyonel: topluluk filtresi)
exports.listAnnouncements = async (req, res) => {
  const db = require('../models');
  const CommunityMember = db.CommunityMember || require('../models/communityMember');
  const user = req.user;
  let allowedCommunityIds = [];
  const { community_id, valilik_id, include_deleted } = req.query;
  // Superadmin ise tüm duyuruları görebilir
  let where = {};
  if (user && user.role === 'superadmin') {
    if (include_deleted === 'true' || include_deleted === true) {
      // Tüm kayıtlar (aktif ve silinmiş)
      where = {};
    } else {
      where = { aktif: true };
    }
    if (community_id && valilik_id) {
      where = { ...where, community_id: Number(community_id), valilik_id: String(valilik_id) };
    } else if (community_id) {
      where = { ...where, community_id: Number(community_id) };
    } else if (valilik_id) {
      where = { ...where, valilik_id: String(valilik_id) };
    }
    const announcements = await Announcement.findAll({ where });
    // Her kayıtta aktif ve deleted flag'i ekle
    const result = announcements.map(a => ({ ...a.toJSON(), deleted: a.aktif === false, aktif: !!a.aktif }));
    return res.json(result);
  }
  // Kullanıcının aktif üyesi olduğu toplulukları bul
  const memberships = await CommunityMember.findAll({
    where: { user_id: user.id, status: 'active' },
    attributes: ['community_id']
  });
  allowedCommunityIds = memberships.map(m => m.community_id);
  // Ayrıca community_id=0 (genel) olanlar da dahil
  allowedCommunityIds.push(0);
  if (include_deleted === 'true' || include_deleted === true) {
    // Aktif ve silinmiş kayıtlar
    where = { community_id: allowedCommunityIds };
  } else {
    // Sadece aktif kayıtlar
    where = { aktif: true, community_id: allowedCommunityIds };
  }
  if (community_id && valilik_id) {
    where = { ...where, community_id: Number(community_id), valilik_id: String(valilik_id) };
  } else if (community_id) {
    const cid = Number(community_id);
    if (!allowedCommunityIds.includes(cid)) {
      return res.status(403).json({ error: 'Bu topluluğun duyurularını görme yetkiniz yok.' });
    }
    where = { ...where, community_id: cid };
  } else if (valilik_id) {
    where = { ...where, valilik_id: String(valilik_id) };
  }
  const announcements = await Announcement.findAll({ where });
  // Her kayıtta aktif ve deleted flag'i ekle
  const result = announcements.map(a => ({ ...a.toJSON(), deleted: a.aktif === false, aktif: !!a.aktif }));
  res.json(result);
};

// Tek bir duyuru detay
exports.getAnnouncement = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Geçersiz id' });
  const announcement = await Announcement.findByPk(id);
  if (!announcement) return res.status(404).json({ error: 'Duyuru bulunamadı' });
  res.json(announcement);
};

// Duyuru oluştur (sadece topluluk lideri)
exports.createAnnouncement = async (req, res) => {
  // Superadmin ise community_members kontrolü atlanır ve duyuru ekleyebilir
  const db = require('../models');
  const User = db.User || require('../models/user');
  const user = await User.findByPk(req.user.id);
  const community_id = req.body.community_id;
  let {
    title, message, valilik_id, keywords, source_url, islenme_tarihi, link, date,
    etkinlik_turu, zorluk_seviyesi, etkinlik_tarihi, etkinlik_suresi, etkinlik_yeri, etkinlik_yeri_id, event_photos,
    baslama_zamani, bitis_zamani
  } = req.body;
  // baslama_zamani ve bitis_zamani string olarak alınır
  if (typeof baslama_zamani !== 'string') baslama_zamani = '';
  if (typeof bitis_zamani !== 'string') bitis_zamani = '';
  if (baslama_zamani === '') baslama_zamani = null;
  if (bitis_zamani === '') bitis_zamani = null;
  // active alanı bitis_zamani'na göre otomatik hesaplanır
  let active = false;
  if (bitis_zamani) {
    const now = new Date();
    const endDate = new Date(bitis_zamani.replace(' ', 'T'));
    if (endDate > now) active = true;
  }
  // etkinlik_tarihi format/parsing
  if (!etkinlik_tarihi || etkinlik_tarihi.length !== 10) {
    etkinlik_tarihi = null;
  } else {
    const [gun, ay, yil] = etkinlik_tarihi.split('/');
    etkinlik_tarihi = `${yil}-${ay}-${gun}`;
    if (isNaN(Date.parse(etkinlik_tarihi))) etkinlik_tarihi = null;
  }
  if (valilik_id === undefined || valilik_id === null) valilik_id = '';
  if (user && user.role !== 'superadmin' && !community_id) {
    return res.status(400).json({ error: 'community_id zorunlu ve eksik (JWT veya body)' });
  }
  if (!title || !message) {
    return res.status(400).json({ error: 'title ve message zorunlu' });
  }
  const created_by = user && user.role === 'superadmin' ? user.id : req.user.id;
  const created_at = new Date();
  const announcement = await Announcement.create({
    community_id, title, message, created_by, created_at, valilik_id, keywords, source_url, islenme_tarihi, link, date,
    etkinlik_turu, zorluk_seviyesi, etkinlik_tarihi, etkinlik_suresi, etkinlik_yeri, etkinlik_yeri_id, event_photos,
    baslama_zamani, bitis_zamani, active
  });
  res.status(201).json(announcement);
};

// Duyuru güncelle (sadece topluluk lideri)
exports.updateAnnouncement = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Geçersiz id' });
  const announcement = await Announcement.findByPk(id);
  if (!announcement) return res.status(404).json({ error: 'Duyuru bulunamadı' });
  // Sadece lider güncelleyebilir, kontrol middleware'de
  // baslama_zamani ve bitis_zamani string olarak alınır
  let { baslama_zamani, bitis_zamani } = req.body;
  if (typeof baslama_zamani !== 'string') baslama_zamani = '';
  if (typeof bitis_zamani !== 'string') bitis_zamani = '';
  if (baslama_zamani === '') baslama_zamani = null;
  if (bitis_zamani === '') bitis_zamani = null;
  // active alanı bitis_zamani'na göre otomatik hesaplanır
  let active = false;
  if (bitis_zamani) {
    const now = new Date();
    const endDate = new Date(bitis_zamani.replace(' ', 'T'));
    if (endDate > now) active = true;
  }
  // etkinlik_tarihi format/parsing
  let etkinlik_tarihi = req.body.etkinlik_tarihi;
  if (!etkinlik_tarihi || etkinlik_tarihi.length !== 10) {
    etkinlik_tarihi = null;
  } else {
    const [gun, ay, yil] = etkinlik_tarihi.split('/');
    etkinlik_tarihi = `${yil}-${ay}-${gun}`;
    if (isNaN(Date.parse(etkinlik_tarihi))) etkinlik_tarihi = null;
  }
  await announcement.update({ ...req.body, etkinlik_tarihi, baslama_zamani, bitis_zamani, active, updated_at: new Date() });
  res.json(announcement);
};

// Duyuru sil (sadece topluluk lideri)
exports.deleteAnnouncement = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Geçersiz id' });
  const announcement = await Announcement.findByPk(id);
  if (!announcement) return res.status(404).json({ error: 'Duyuru bulunamadı' });
  // Güncel kullanıcı rolünü veritabanından çek
  const db = require('../models');
  const User = db.User || require('../models/user');
  const user = await User.findByPk(req.user.id);
  if (!user) return res.status(403).json({ error: 'Kullanıcı bulunamadı' });
  if (user.role === 'superadmin') {
    await announcement.update({ aktif: false, updated_at: new Date() });
    return res.status(200).json({ message: 'Duyuru silindi (soft delete)' });
  }
  // Community_members tablosunda ilgili toplulukta leader mı?
  const CommunityMember = db.CommunityMember || require('../models/communityMember');
  const member = await CommunityMember.findOne({ where: { community_id: announcement.community_id, user_id: user.id, status: 'active', role: 'leader' } });
  if (member) {
    if (announcement.created_by !== user.id) {
      return res.status(403).json({ error: 'Lider sadece kendi oluşturduğu duyuruyu silebilir.' });
    }
    await announcement.update({ aktif: false, updated_at: new Date() });
    return res.status(200).json({ message: 'Duyuru silindi (soft delete)' });
  }
  // Diğer roller için silme izni yok
  return res.status(403).json({ error: 'Bu işlemi yapmaya yetkiniz yok.' });
};
