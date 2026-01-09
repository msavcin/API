const db = require('../models');
const CampgroundImage = db.CampgroundImage || require('../models/campgroundImage');
const s3 = require('../utils/s3');
const path = require('path');

// Fotoğraf Ekle
exports.createCampgroundImage = async (req, res) => {
  try {
    const { campground_id, image_id, image_url, source, uploaded_by, created_by } = req.body;
    if (!campground_id || !image_id || !image_url) {
      return res.status(400).json({ error: 'campground_id, image_id, image_url zorunlu' });
    }
    const image = await CampgroundImage.create({ campground_id, image_id, image_url, source, uploaded_by, created_by });
    res.status(201).json(image);
  } catch (err) {
    res.status(500).json({ error: 'Fotoğraf eklenemedi', detail: err.message });
  }
};

// Fotoğrafları Listele
exports.listCampgroundImages = async (req, res) => {
  try {
    const { campground_id } = req.query;
    const where = {};
    if (campground_id) where.campground_id = campground_id;
    const images = await CampgroundImage.findAll({ where });
    res.json(images);
  } catch (err) {
    res.status(500).json({ error: 'Fotoğraflar listelenemedi', detail: err.message });
  }
};

// Fotoğraf Sil
exports.deleteCampgroundImage = async (req, res) => {
  try {
    const { id, image_id } = req.params.id ? { id: req.params.id } : req.query;
    let image = null;
    if (id) {
      image = await CampgroundImage.findByPk(id);
    } else if (image_id) {
      image = await CampgroundImage.findOne({ where: { image_id } });
    }
    if (!image) return res.status(404).json({ error: 'Fotoğraf bulunamadı' });
    await image.destroy();
    res.json({ message: 'Fotoğraf silindi' });
  } catch (err) {
    res.status(500).json({ error: 'Fotoğraf silinemedi', detail: err.message });
  }
};

// Fotoğraf dosyası yükle (S3 entegrasyonu)
exports.uploadCampgroundImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Dosya gerekli (file alanı ile gönderilmeli)' });
    }
    const fileExt = path.extname(req.file.originalname) || '.jpg';
    const fileName = `campground_images/${Date.now()}_${Math.random().toString(36).slice(2)}${fileExt}`;
    const params = {
      Bucket: process.env.AWS_S3_BUCKET,
      Key: fileName,
      Body: req.file.buffer,
      ContentType: req.file.mimetype
    };
    // S3'e gönderilen dosya ve parametreleri logla
    console.log('[S3][UPLOAD][DEBUG] Gönderilen dosya:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      fileName,
      params: { ...params, Body: `[buffer:${req.file.buffer.length} bytes]` }
    });
    s3.upload(params, (err, data) => {
      if (err) {
        console.error('[S3][UPLOAD][ERROR]', err);
        return res.status(500).json({ error: 'S3 upload hatası', detail: err.message });
      }
      console.log('[S3][UPLOAD][SUCCESS]', data);
      res.json({ image_url: data.Location, key: data.Key });
    });
  } catch (err) {
    console.error('[S3][UPLOAD][CATCH]', err);
    res.status(500).json({ error: 'Dosya yüklenemedi', detail: err.message });
  }
};
