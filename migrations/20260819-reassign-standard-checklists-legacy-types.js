'use strict';

/**
 * standard_checklists.camping_type_id FK: tent/caravan/nature (id 1/2/3)
 * kayıtlarını campground / caravan_site / hiking_road satırlarına taşır.
 * Böylece eski camping_types satırları pasifleştirilebilir / silinebilir.
 */

const PAIRS = [
  { fromCodes: ['tent', 'legacy_1', '1'], toCode: 'campground' },
  { fromCodes: ['caravan', 'legacy_2', '2'], toCode: 'caravan_site' },
  { fromCodes: ['nature', 'legacy_3', '3'], toCode: 'hiking_road' },
];

module.exports = {
  up: async (queryInterface) => {
    const transaction = await queryInterface.sequelize.transaction();
    const q = (sql, replacements) =>
      queryInterface.sequelize.query(sql, { transaction, replacements });

    try {
      const [types] = await q(`SELECT id, code FROM camping_types`);
      const byCode = new Map(types.map((t) => [String(t.code).toLowerCase(), t]));
      const byId = new Map(types.map((t) => [String(t.id), t]));

      for (const pair of PAIRS) {
        const to = byCode.get(pair.toCode);
        if (!to) {
          console.log(`[Migration] Hedef yok, atlandı: ${pair.toCode}`);
          continue;
        }

        const fromTypes = pair.fromCodes
          .map((code) => byCode.get(code) || byId.get(code))
          .filter((row) => row && Number(row.id) !== Number(to.id));

        const tokens = new Set(pair.fromCodes.map(String));
        fromTypes.forEach((row) => {
          tokens.add(String(row.id));
          if (row.code) tokens.add(String(row.code));
        });

        const tokenList = [...tokens];
        console.log(`[Migration] ${pair.toCode} (${to.id}) <-`, tokenList);

        const [oldLists] = await q(
          `SELECT id, season_id, camping_type_id
           FROM standard_checklists
           WHERE camping_type_id::text IN (:tokens)`,
          { tokens: tokenList }
        );

        for (const old of oldLists) {
          const [existing] = await q(
            `SELECT id FROM standard_checklists
             WHERE season_id::text = :seasonId
               AND camping_type_id::text = :newId
               AND id <> :oldId
             LIMIT 1`,
            { seasonId: String(old.season_id), newId: String(to.id), oldId: old.id }
          );

          if (existing && existing[0]) {
            const keepId = existing[0].id;
            await q(
              `UPDATE standard_checklist_items
               SET checklist_id = :keepId
               WHERE checklist_id = :oldId`,
              { keepId, oldId: old.id }
            );
            await q(`DELETE FROM standard_checklists WHERE id = :oldId`, { oldId: old.id });
            console.log(`[Migration] checklist ${old.id} birleştirildi -> ${keepId}`);
          } else {
            await q(
              `UPDATE standard_checklists
               SET camping_type_id = :newId
               WHERE id = :oldId`,
              { newId: String(to.id), oldId: old.id }
            );
            console.log(`[Migration] checklist ${old.id} camping_type_id -> ${to.id}`);
          }
        }

        await q(
          `UPDATE camping_types
           SET active = false, deleted_at = COALESCE(deleted_at, NOW()), updated_at = NOW()
           WHERE id IN (:ids)`,
          { ids: fromTypes.length ? fromTypes.map((t) => t.id) : [0] }
        );
      }

      await transaction.commit();
      console.log('[Migration] standard_checklists legacy FK taşıması tamam');
    } catch (error) {
      await transaction.rollback();
      console.error('[Migration] Hata:', error);
      throw error;
    }
  },

  down: async () => {
    // Geri almak checklist birleştirmesini güvenli geri saramaz.
    console.log('[Migration] down: no-op');
  },
};
