const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const region = process.env.AWS_REGION || 'eu-central-1';
const s3Client = new S3Client({
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function getPutObjectSignedUrl({ Bucket, Key, ContentType, expiresIn = 60 }) {
  const command = new PutObjectCommand({ Bucket, Key, ContentType });
  return await getSignedUrl(s3Client, command, { expiresIn });
}

async function uploadObject(params) {
  const command = new PutObjectCommand(params);
  const res = await s3Client.send(command);
  const endpoint = process.env.AWS_S3_ENDPOINT || `https://${params.Bucket}.s3.${region}.amazonaws.com`;
  const location = `${endpoint}/${params.Key}`;
  return { Location: location, Key: params.Key, ETag: res.ETag };
}

module.exports = {
  s3Client,
  getPutObjectSignedUrl,
  upload: (params, cb) => {
    uploadObject(params).then(data => cb(null, data)).catch(cb);
  },
};
