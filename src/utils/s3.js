const AWS = require('aws-sdk');

// AWS S3 ayarları (env ile alınmalı)
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'eu-central-1',
});

module.exports = s3;
