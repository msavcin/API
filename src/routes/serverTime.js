const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  const now = new Date();
  res.json({
    utc: now.toISOString(),
    local: now.toString(),
    timestamp: now.getTime()
  });
});

module.exports = router;
