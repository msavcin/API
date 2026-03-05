const fs = require('fs');
const path = require('path');

function normalizeKey(raw) {
  if (!raw) return null;
  // Remove whitespace/newlines
  return raw.replace(/\s+/g, '');
}

function getPublicKey(req, res) {
  // Prefer environment variable, fallback to config file
  const fromEnv = process.env.LICENSE_RSA_PUBLIC_KEY;
  let key = fromEnv;
  if (!key) {
    try {
      const cfgPath = path.resolve(__dirname, '../../config/config.json');
      if (fs.existsSync(cfgPath)) {
        const cfg = require(cfgPath);
        key = cfg && cfg.licensePublicKey;
      }
    } catch (e) {
      console.warn('[LICENSE] config okunamadı', e && e.message);
    }
  }

  if (!key) {
    return res.status(500).json({ error: 'License public key not configured on server' });
  }

  const normalized = normalizeKey(key);
  // Return as JSON so frontend can use it easily
  return res.json({ key: normalized });
}

module.exports = { getPublicKey };
