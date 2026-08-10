#!/usr/bin/env node
'use strict';
const db = require('../models');
const sequelize = db.sequelize;
const { QueryTypes } = require('sequelize');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('DB bağlantısı başarılı.');

    const src = '1';

    const updateSql = `
      UPDATE campgrounds
      SET google_rating = CASE WHEN rating IS NULL THEN NULL ELSE rating::real END,
          google_review_count = review_count
      WHERE source_id = :src
        AND (google_rating IS DISTINCT FROM (rating::real) OR google_review_count IS DISTINCT FROM review_count)
      RETURNING id;
    `;

    const [updatedRows] = await sequelize.query(updateSql, { replacements: { src } });
    const updatedCount = Array.isArray(updatedRows) ? updatedRows.length : 0;
    console.log('Güncellenen satır sayısı:', updatedCount);

    const verifySql = `
      SELECT COUNT(*)::int AS matched_rows
      FROM campgrounds
      WHERE source_id = :src
        AND google_rating = rating::real
        AND google_review_count = review_count;
    `;
    const verifyRows = await sequelize.query(verifySql, { replacements: { src }, type: QueryTypes.SELECT });
    const matched = verifyRows && verifyRows[0] ? verifyRows[0].matched_rows : 0;
    console.log('Doğrulanan eşleşen satır sayısı:', matched);

    await sequelize.close();
    process.exit(0);
  } catch (err) {
    console.error('Hata:', err);
    try { await sequelize.close(); } catch (e) {}
    process.exit(1);
  }
})();
