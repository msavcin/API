const db = require('../models');
const Campground = db.Campground || require('../models/campground');
const { Op } = require('sequelize');

// 1. Kamp Alanı Ekle
exports.createCampground = async (req, res) => {
  // Kullanıcı kimliği ve policy logu
  console.log('[CREATE][AUTH] req.user:', req.user);

  try {
  console.log('POST /campgrounds req.body:', req.body);
  console.log('[DEBUG][FRIEND_USER_IDS] Gelen friend_user_ids:', req.body.friend_user_ids, 'Tip:', typeof req.body.friend_user_ids, 'isArray:', Array.isArray(req.body.friend_user_ids));

    let {
      name, latitude, longitude, type, description, website, phone, opening_hours, capacity, fee, status, rating, review_count, price_range,
      facilities, accessibility, social_media, amenities, images, tags, booking_url, contact_email, last_verified, visibility, owner_id, community_id,
      friend_user_ids,
      created_at, updated_at, external_id, source_id = 0, photo_links
    } = req.body;


    // created_at ve updated_at string olarak set edilmeli
    if (!created_at || typeof created_at !== 'string') {
      created_at = new Date().toISOString();
    }
    if (!updated_at || typeof updated_at !== 'string') {
      updated_at = new Date().toISOString();
    }

    // photo_links: kesinlikle string olarak insert edilmeli
    if (photo_links === null || photo_links === undefined) {
      photo_links = JSON.stringify([]);
    } else if (Array.isArray(photo_links) || typeof photo_links === 'object') {
      photo_links = JSON.stringify(photo_links);
    } else if (typeof photo_links !== 'string') {
      photo_links = JSON.stringify([]);
    }

  // Eğer kullanıcı ekliyorsa (source_id 0), visibility default olarak 'private' olsun
  if (parseInt(source_id) === 0) {
    if (!visibility) visibility = 'private';
  }

  // community visibility logic: assign community_id automatically and force updated_at
  if (visibility === 'community') {
    const CommunityMember = db.CommunityMember || require('../models/communityMember');
    try {
      const membership = await CommunityMember.findOne({ where: { user_id: req.user && req.user.id } });
      if (membership) {
        community_id = membership.community_id;
      } else {
        // user asked community visibility but has no community membership
        return res.status(400).json({ error: 'Kullanıcı herhangi bir topluluğa üye değil' });
      }
    } catch (e) {
      console.error('[CREATE][COMMUNITY] error fetching membership', e);
      return res.status(500).json({ error: 'Topluluk bilgisi alınamadı' });
    }
    // updated_at must be fresh when turning visibility=community
    updated_at = new Date().toISOString();
  }
  // friends visibility: only use explicitly provided friend_user_ids, ignore other friendships
  if (visibility === 'friends') {
    // ensure it's an array
    if (friend_user_ids && !Array.isArray(friend_user_ids)) {
      try { friend_user_ids = JSON.parse(friend_user_ids); } catch (e) { friend_user_ids = []; }
    }
    if (!friend_user_ids) {
      friend_user_ids = [];
    }
    // updated_at should reflect new visibility
    updated_at = new Date().toISOString();
  }
  if (accessibility && typeof accessibility !== 'string') accessibility = JSON.stringify(accessibility);
  if (social_media && typeof social_media !== 'string') social_media = JSON.stringify(social_media);
  if (amenities && typeof amenities !== 'string') amenities = JSON.stringify(amenities);
  if (images && typeof images !== 'string') images = JSON.stringify(images);
  if (tags && typeof tags !== 'string') tags = JSON.stringify(tags);
  // photo_links ARRAY olduğu için dizi olarak bırakılır

  // Detaylı loglama: gelen değerler
  console.log('[DEBUG] facilities (gelen):', facilities);
  console.log('[DEBUG] accessibility (gelen):', accessibility);
  console.log('[DEBUG] social_media (gelen):', social_media);
  console.log('[DEBUG] amenities (gelen):', amenities);
  console.log('[DEBUG] images (gelen):', images);
  console.log('[DEBUG] tags (gelen):', tags);

    // facilities, accessibility, social_media string gelirse JSON.parse ile işle
    // Eğer boş string, null, undefined ise null ata; değilse JSON.parse uygula
    if (typeof facilities === 'string') {
      if (facilities.trim() === '') {
        facilities = null;
      } else {
        try { facilities = JSON.parse(facilities); } catch (e) { return res.status(400).json({ error: 'facilities alanı geçerli bir JSON değil' }); }
      }
    } else if (facilities === null || facilities === undefined) {
      facilities = null;
    }
    if (typeof accessibility === 'string') {
      if (accessibility.trim() === '') {
        accessibility = null;
      } else {
        try { accessibility = JSON.parse(accessibility); } catch (e) { return res.status(400).json({ error: 'accessibility alanı geçerli bir JSON değil' }); }
      }
    } else if (accessibility === null || accessibility === undefined) {
      accessibility = null;
    }
    if (typeof social_media === 'string') {
      if (social_media.trim() === '') {
        social_media = null;
      } else {
        try { social_media = JSON.parse(social_media); } catch (e) { return res.status(400).json({ error: 'social_media alanı geçerli bir JSON değil' }); }
      }
    } else if (social_media === null || social_media === undefined) {
      social_media = null;
    }
    if (!name || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'name, latitude, longitude zorunlu' });
    }
    if (parseInt(source_id) === 0 && !owner_id) {
      return res.status(400).json({ error: 'owner_id zorunlu' });
    }
    // Dizi/obje olanları string olarak kaydet
    if (facilities && typeof facilities !== 'string') facilities = JSON.stringify(facilities);
    if (accessibility && typeof accessibility !== 'string') accessibility = JSON.stringify(accessibility);
    if (social_media && typeof social_media !== 'string') social_media = JSON.stringify(social_media);
    // amenities alanı: array/string/null/undefined/obje tüm durumlar için hatasız blok
    if (Array.isArray(amenities)) {
      console.log('[amenities debug] Gelen amenities array:', amenities);
      amenities = JSON.stringify(amenities);
    } else if (typeof amenities === 'string') {
      if (amenities.trim() === '') {
        console.log('[amenities debug] Gelen amenities boş string, [] atanıyor. Orijinal:', amenities);
        amenities = JSON.stringify([]);
      } else {
        console.log('[amenities debug] Gelen amenities string:', amenities);
        // string olarak bırak
      }
    } else if (amenities === undefined || amenities === null) {
      console.log('[amenities debug] Gelen amenities undefined/null, [] atanıyor. Orijinal:', amenities);
      amenities = JSON.stringify([]);
    } else {
      // Diğer tipler (ör: obje) için de diziye çevir
      console.log('[amenities debug] Gelen amenities diğer tip, diziye çevriliyor:', amenities);
      amenities = JSON.stringify([amenities]);
    }
    if (images && typeof images !== 'string') images = JSON.stringify(images);
    // tags alanı undefined/null/boş string ise '{}' olarak işle
    if (tags === undefined || tags === null || (typeof tags === 'string' && tags.trim() === '')) {
      tags = JSON.stringify({});
    } else if (typeof tags !== 'string') {
      tags = JSON.stringify(tags);
    }
  if (facilities && typeof facilities !== 'string') facilities = JSON.stringify(facilities);
  if (accessibility && typeof accessibility !== 'string') accessibility = JSON.stringify(accessibility);
  if (social_media && typeof social_media !== 'string') social_media = JSON.stringify(social_media);
  if (images && typeof images !== 'string') images = JSON.stringify(images);
  if (tags && typeof tags !== 'string') tags = JSON.stringify(tags);
    // opening_hours: array of string veya string olarak gelebilir, veritabanına string olarak kaydedilecek
    if (Array.isArray(opening_hours)) {
      opening_hours = JSON.stringify(opening_hours);
    } else if (typeof opening_hours !== 'string') {
      opening_hours = JSON.stringify([]);
    }
    // fee boolean veya string gelirse 1/0 integer olarak kaydet
    // fee: undefined, null, boş string veya geçersizse 0 olarak ata, her durumda integer olarak kaydet
    if (typeof fee === 'boolean') fee = fee ? 1 : 0;
    else if (typeof fee === 'string') {
      if (fee === 'true' || fee === '1') fee = 1;
      else if (fee === 'false' || fee === '0') fee = 0;
      else if (fee.trim() === '') fee = 0;
      else fee = Number(fee) || 0;
    } else if (typeof fee === 'number') {
      fee = fee ? 1 : 0;
    } else {
      fee = 0;
    }
    console.log('[CREATE][DB] amenities veritabanına yazılacak değer:', amenities);
    const campground = await Campground.create({
      name, latitude, longitude, type, description, website, phone, opening_hours, capacity, fee, status, rating, review_count, price_range, facilities, accessibility, social_media, amenities, images, tags, booking_url, contact_email, last_verified, visibility, community_id, owner_id, friend_user_ids: friend_user_ids && JSON.stringify(friend_user_ids), created_at, updated_at, external_id, source_id, photo_links
    });

    // Eğer friend_user_ids varsa, erişim tablosuna ekle
    if (Array.isArray(friend_user_ids) && friend_user_ids.length > 0) {
      const CampgroundFriendAccess = db.CampgroundFriendAccess;
      const accessRecords = friend_user_ids.map(fid => ({ campground_id: campground.id, friend_user_id: parseInt(fid, 10) }));
      await CampgroundFriendAccess.bulkCreate(accessRecords);
    }
  console.log('[CREATE][RESPONSE] amenities:', campground.amenities);
  res.status(201).json(campground.toJSON());
  } catch (err) {
    res.status(500).json({ error: 'Kamp alanı eklenemedi', detail: err.message });
  }
};

// 2. Kamp Alanı Listele
exports.listCampgrounds = async (req, res) => {
  // Kullanıcı kimliği ve policy logu
  console.log('[LIST][AUTH] req.user:', req.user, 'query:', req.query);
  try {
    const { source_id, owner_id, updated_after, type, deleted, community_id } = req.query;
    const where = {};
    if (source_id !== undefined) where.source_id = source_id;
    if (community_id !== undefined) where.community_id = community_id;
    if (updated_after) {
      where.updated_at = { [Op.gt]: new Date(updated_after) };
    }
    if (owner_id !== undefined) {
      where[Op.or] = [
        { owner_id: owner_id, visibility: 'private' },
        { visibility: 'public' }
      ];
    }
    // type filtresi ARRAY için
    if (type !== undefined) {
      // Birden fazla type gelirse diziye çevir
      let typeArr = Array.isArray(type) ? type : [type];
      where.type = { [Op.contains]: typeArr };
    }
    // deleted parametresi ile filtreleme
    if (deleted !== undefined) {
      if (deleted === 'true' || deleted === '1' || deleted === 1 || deleted === true) {
        where.deleted = 1;
      } else if (deleted === 'false' || deleted === '0' || deleted === 0 || deleted === false) {
        where.deleted = 0;
      }
    }
    // Kullanıcı id'si
    const userId = req.user && req.user.id;
    const CampgroundFriendAccess = db.CampgroundFriendAccess;
    // Tüm kamp alanlarını çek
    let campgrounds = await Campground.findAll({ where });
    // visibility 'friends' olanlar için erişim kontrolü uygula
    campgrounds = await Promise.all(campgrounds.map(async cg => {
      try {
        if (cg.visibility === 'friends') {
          if (cg.owner_id === userId || (req.user && req.user.role === 'superadmin')) return cg;
          if (!userId) return null;
          const accesses = await CampgroundFriendAccess.findAll({ where: { campground_id: cg.id } });
          const friendUserIds = accesses.map(a => a.friend_user_id);
          if (friendUserIds.includes(userId)) return cg;
          return null;
        }
        if (cg.visibility === 'community') {
          if (req.user && req.user.role === 'superadmin') return cg;
          if (!userId) return null;
          const CommunityMember = db.CommunityMember;
          if (!cg.community_id) return null;
          const membership = await CommunityMember.findOne({ where: { user_id: userId, community_id: cg.community_id } });
          if (membership) return cg;
          return null;
        }
        return cg;
      } catch (err) {
        console.error('[CAMPGROUND][VISIBILITY][ERROR]', err);
        return null;
      }
    }));
    campgrounds = campgrounds.filter(Boolean);

    // Delta Sync: silinen kayıtları ekle
    let deletedRecords = [];
    if (req.query.updated_after && req.query.include_deleted === 'true') {
      const CampgroundDeleted = require('../models/campgroundDeleted');
      deletedRecords = await CampgroundDeleted.findAll({
        where: {
          deleted_at: { [Op.gt]: new Date(req.query.updated_after) }
        },
        attributes: ['external_id', ['deleted_at', 'updated_at'], [db.sequelize.literal('1'), 'deleted']]
      });
    }

    // owner_username ekle
    const User = require('../models/user');
    const ownerIds = [...new Set(campgrounds.map(cg => Number(cg.owner_id)).filter(Boolean))];
    const owners = await User.findAll({ where: { id: ownerIds }, attributes: ['id', 'username'] });
    const ownerMap = Object.fromEntries(owners.map(o => [o.id, o.username]));
    const campgroundsWithOwner = campgrounds.map(cg => {
      const ownerId = Number(cg.owner_id);
      const ownerUsername = ownerMap[ownerId] || null;
      return {
        ...cg.toJSON(),
        owner_username: ownerUsername
      };
    });

    // Silinen kayıtları da ekle
    const allRecords = [...campgroundsWithOwner, ...deletedRecords.map(dr => dr.toJSON())];
    res.json(allRecords);
  } catch (err) {
    res.status(500).json({ error: 'Kamp alanları listelenemedi', detail: err.message });
  }
};

// 3. Kamp Alanı Detay
exports.getCampground = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const campground = await Campground.findByPk(id);
    if (!campground) return res.status(404).json({ error: 'Kamp alanı bulunamadı' });
    res.json(campground);
  } catch (err) {
    res.status(500).json({ error: 'Kamp alanı getirilemedi', detail: err.message });
  }
};

// 4. Kamp Alanı Sil
exports.deleteCampground = async (req, res) => {
  // owner_id artık JWT'den alınacak
  const owner_id = req.user && req.user.id;
  console.log('[DELETE] /campgrounds/:id', { params: req.params, body: req.body, query: req.query, user: req.user });
  console.log('[API][DELETE] Silme isteği alındı:', { id: req.params.id, owner_id });
  try {
    let campground = null;
    const idOrExternal = req.params.id;
    // Önce external_id ile ara
    campground = await Campground.findOne({ where: { external_id: idOrExternal } });
    // Bulamazsa id ile ara
    if (!campground) {
      const id = parseInt(idOrExternal, 10);
      if (!isNaN(id)) {
        campground = await Campground.findByPk(id);
      }
    }
    if (!campground) return res.status(404).json({ error: 'Kamp alanı bulunamadı' });
    // Superadmin her kaydı silebilir
    if (!(req.user && req.user.role === 'superadmin')) {
      if (String(campground.source_id) !== "0" || Number(campground.owner_id) !== Number(owner_id)) {
        return res.status(403).json({ error: 'Sadece kendi eklediğiniz kamp alanını silebilirsiniz' });
      }
    }
    // Çakışma kontrolü: last-write-wins
    if (req.body.updated_at && new Date(req.body.updated_at) < new Date(campground.updated_at)) {
      return res.status(409).json({ error: 'Çakışma: Sunucudaki kayıt daha güncel', server_updated_at: campground.updated_at });
    }
    // Silinen kaydı campgrounds_deleted tablosuna ekle
    const CampgroundDeleted = require('../models/campgroundDeleted');
    await CampgroundDeleted.create({
      external_id: campground.external_id,
      deleted_at: new Date()
    });
    console.log('[SYNC][DELETE][STEP] Veritabanından siliniyor:', { id: campground.id, external_id: campground.external_id });
    await campground.destroy();
    res.json({ message: 'Kamp alanı silindi' });
  } catch (err) {
    res.status(500).json({ error: 'Kamp alanı silinemedi', detail: err.message });
  }
};

// 5. Kamp Alanı Güncelle
exports.updateCampground = async (req, res) => {
  // Policy ve yetki logu
  console.log('[UPDATE][AUTH] req.user:', req.user, 'params:', req.params);
  // Policy ve yetki logu
  console.log('[DELETE][AUTH] req.user:', req.user, 'params:', req.params);
  // amenities, images, tags alanlarının güncellenip güncellenmediğini logla
  console.log('[UPDATE][CHECK] amenities:', req.body.amenities, 'images:', req.body.images, 'tags:', req.body.tags);
  // Güncelleme isteği için detaylı log
  console.log('[UPDATE] /campgrounds/:id', { params: req.params, body: req.body, user: req.user });
  console.log('[DEBUG][FRIEND_USER_IDS][UPDATE] Gelen friend_user_ids:', req.body.friend_user_ids, 'Tip:', typeof req.body.friend_user_ids, 'isArray:', Array.isArray(req.body.friend_user_ids));
  try {
    const owner_id = req.user && req.user.id;
    const idOrExternal = req.params.id;
    let campground = null;

    // Önce external_id ile ara
    campground = await Campground.findOne({ where: { external_id: idOrExternal } });
    // Bulamazsa id ile ara
    if (!campground) {
      const id = parseInt(idOrExternal, 10);
      if (!isNaN(id)) {
        campground = await Campground.findByPk(id);
      }
    }
    if (!campground) return res.status(404).json({ error: 'Kamp alanı bulunamadı' });

    // Sadece kendi eklediği kamp alanını güncelleyebilir, superadmin ise atlanır
    // Karşılaştırma öncesi tip ve değer logu
    console.log('[AUTH][UPDATE][DEBUG] Karşılaştırma öncesi:', {
      user_id: owner_id,
      user_id_type: typeof owner_id,
      campground_owner_id: campground.owner_id,
      campground_owner_id_type: typeof campground.owner_id
    });
    if (!(req.user && req.user.role === 'superadmin')) {
      if (String(campground.source_id) !== "0" || String(campground.owner_id) !== String(owner_id)) {
        console.warn('[AUTH][UPDATE][403] Yetkisiz güncelleme girişimi:', {
          user_id: owner_id,
          campground_id: campground.id,
          campground_owner_id: campground.owner_id,
          source_id: campground.source_id,
          external_id: campground.external_id,
          loose_equal: campground.owner_id == owner_id,
          strict_equal: campground.owner_id === owner_id
        });
        return res.status(403).json({ error: 'Sadece kendi eklediğiniz kamp alanını güncelleyebilirsiniz' });
      }
    }

    // Çakışma kontrolü: last-write-wins
    if (req.body.updated_at && new Date(req.body.updated_at) < new Date(campground.updated_at)) {
      return res.status(409).json({ error: 'Çakışma: Sunucudaki kayıt daha güncel', server_updated_at: campground.updated_at });
    }

    // Güncellenebilir alanlar
    const updatableFields = [
      'name', 'latitude', 'longitude', 'type', 'description', 'website', 'phone', 'opening_hours', 'capacity', 'fee',
      'status', 'rating', 'review_count', 'price_range', 'facilities', 'accessibility', 'social_media', 'amenities',
      'images', 'tags', 'booking_url', 'contact_email', 'last_verified', 'visibility', 'external_id', 'source_id', 'photo_links',
      'friend_user_ids'
    ];

    // amenities, images, tags, facilities, accessibility, social_media için uygun tip dönüşümleri
    updatableFields.forEach(field => {
      if (req.body[field] !== undefined) {
        let value = req.body[field];
        if (["facilities", "accessibility", "social_media"].includes(field)) {
          if (value && typeof value !== 'string') value = JSON.stringify(value);
        }
        if (field === "amenities") {
          if (Array.isArray(value)) {
            value = JSON.stringify(value);
          } else if (typeof value === 'string') {
            if (value.trim() === '') {
              value = JSON.stringify([]);
            }
            // string ise olduğu gibi bırak
          } else if (value === undefined || value === null) {
            value = JSON.stringify([]);
          } else {
            value = JSON.stringify([value]);
          }
        }
        if (field === "images") {
          if (value && typeof value !== 'string') value = JSON.stringify(value);
        }
        if (field === "tags") {
          if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
            value = JSON.stringify({});
          } else if (typeof value !== 'string') {
            value = JSON.stringify(value);
          }
        }
        if (field === 'friend_user_ids') {
          if (Array.isArray(value)) {
            // ensure JSON string format
            campground[field] = JSON.stringify(value);
            return;
          } else if (typeof value === 'string') {
            // leave string but ensure valid JSON
            try { JSON.parse(value); } catch (e) { value = JSON.stringify([]); }
            campground[field] = value;
            return;
          } else {
            campground[field] = JSON.stringify([]);
            return;
          }
        }
        campground[field] = value;
      }
    });

    // updated_at alanı kesinlikle string olmalı
    if (!req.body.updated_at || typeof req.body.updated_at !== 'string') {
      campground.updated_at = new Date().toISOString();
    } else {
      campground.updated_at = req.body.updated_at;
    }

    // if visibility changed to community or friends during update, handle ids and timestamp
    if (req.body.visibility === 'community') {
      const CommunityMember = db.CommunityMember || require('../models/communityMember');
      try {
        const membership = await CommunityMember.findOne({ where: { user_id: owner_id } });
        if (membership) {
          campground.community_id = membership.community_id;
        } else {
          return res.status(400).json({ error: 'Kullanıcı herhangi bir topluluğa üye değil' });
        }
      } catch (e) {
        console.error('[UPDATE][COMMUNITY] error fetching membership', e);
        return res.status(500).json({ error: 'Topluluk bilgisi alınamadı' });
      }
      campground.updated_at = new Date().toISOString();
    } else if (req.body.visibility === 'friends') {
      // expect provided friend_user_ids list
      let ids = req.body.friend_user_ids;
      if (ids && !Array.isArray(ids)) {
        try { ids = JSON.parse(ids); } catch (e) { ids = []; }
      }
      if (!ids) ids = [];
      campground.friend_user_ids = JSON.stringify(ids);
      // sync access table to provided list
      try {
        const CampgroundFriendAccess = db.CampgroundFriendAccess;
        await CampgroundFriendAccess.destroy({ where: { campground_id: campground.id } });
        const accessRecords = ids.map(fid => ({ campground_id: campground.id, friend_user_id: parseInt(fid, 10) }));
        if (accessRecords.length) await CampgroundFriendAccess.bulkCreate(accessRecords);
      } catch (e) {
        console.error('[UPDATE][FRIENDS] error syncing access records', e);
      }
      campground.updated_at = new Date().toISOString();
    } else if (req.body.visibility && req.body.visibility !== 'community') {
      // clear community_id if visibility moved away
      campground.community_id = null;
    }
    if (req.body.visibility && req.body.visibility !== 'friends') {
      campground.friend_user_ids = JSON.stringify([]);
      // remove any lingering friend access entries
      try {
        const CampgroundFriendAccess = db.CampgroundFriendAccess;
        await CampgroundFriendAccess.destroy({ where: { campground_id: campground.id } });
      } catch (e) {
        console.error('[UPDATE][FRIENDS] error clearing access records', e);
      }
    }
    // Güncellenen alanları ve tiplerini logla
    const updatedFields = {};
    updatableFields.forEach(field => {
      updatedFields[field] = { value: campground[field], type: typeof campground[field] };
    });
    console.log('[UPDATE][DEBUG] Veritabanına kaydedilecek alanlar:', updatedFields);
    await campground.save();
    // Kayıt gerçekten güncellendi mi, tekrar oku ve logla
    const refreshed = await Campground.findByPk(campground.id);
    const refreshedObj = refreshed ? refreshed.toJSON() : null;
    if (refreshedObj) {
      if (!('amenities' in refreshedObj)) console.warn('[UPDATE][VERIFY][WARN] amenities alanı DB kaydında yok!');
      if (!('images' in refreshedObj)) console.warn('[UPDATE][VERIFY][WARN] images alanı DB kaydında yok!');
      if (!('tags' in refreshedObj)) console.warn('[UPDATE][VERIFY][WARN] tags alanı DB kaydında yok!');
    }
    console.log('[UPDATE][VERIFY] DB kaydı:', refreshedObj);
    // amenities alanını array olarak response'a ekle
    let responseObj = refreshed ? refreshed.toJSON() : campground.toJSON();
    try {
      responseObj.amenities = JSON.parse(responseObj.amenities || '[]');
    } catch (e) {
      responseObj.amenities = [];
    }
    // Eğer friend_user_ids varsa, erişim tablosunu güncelle
    const { friend_user_ids } = req.body;
    if (Array.isArray(friend_user_ids)) {
      const CampgroundFriendAccess = db.CampgroundFriendAccess;
      // Önce eski erişimleri sil
      await CampgroundFriendAccess.destroy({ where: { campground_id: campground.id } });
      // Sonra yenilerini ekle
      const records = friend_user_ids.map(friend_user_id => ({ campground_id: campground.id, friend_user_id: parseInt(friend_user_id, 10) }));
      await CampgroundFriendAccess.bulkCreate(records);
    }
  res.json({ updated: true, data: responseObj });
  } catch (err) {
    res.status(500).json({ error: 'Kamp alanı güncellenemedi', detail: err.message });
  }
};
