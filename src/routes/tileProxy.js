const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const apicache = require('apicache');
const cache = apicache.middleware;

const router = express.Router();

const cacheDuration = 60 * 60 * 24 * 7; // 7 gün

// OpenStreetMap tile'larını cache'le
const tileProxy = createProxyMiddleware({
  target: 'https://tile.openstreetmap.org',
  changeOrigin: true,
  pathRewrite: {
    '^/node/tiles': '',
  },
  onError: (err, req, res) => {
    res.status(500).json({ error: 'Tile proxy hatası', detail: err.message });
  }
});

// /tiles/{z}/{x}/{y}.png isteklerini proxy'le
router.get('/:z/:x/:y.png', cache(`${cacheDuration} seconds`), tileProxy);

module.exports = router;

