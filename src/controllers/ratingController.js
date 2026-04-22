const jwt = require('jsonwebtoken');
const db = require('../models');
const Rating = db.Rating;
const Campground = db.Campground;
const User = db.User;

const JWT_SECRET = process.env.JWT_SECRET || 'demo_secret_key';

function sanitizeComment(text) {
  if (!text && text !== '') return null;
  const s = String(text);
  // basic strip-tags
  return s.replace(/<[^>]*>/g, '').trim().slice(0, 2000);
}

async function optionalAuthenticate(req) {
  const authHeader = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!authHeader) return null;
  const token = authHeader.split(' ')[1];
  if (!token) return null;
  try {
    const user = jwt.verify(token, JWT_SECRET);
    return user;
  } catch (e) {
    return null;
  }
}

async function findCampgroundByIdOrExternal(idOrExternal) {
  if (!idOrExternal) return null;
  let campground = await Campground.findOne({ where: { external_id: idOrExternal } });
  if (!campground) {
    const id = parseInt(idOrExternal, 10);
    if (!isNaN(id)) {
      campground = await Campground.findByPk(id);
    }
  }
  return campground;
}

async function listRatings(req, res) {
  try {
    const campground = await findCampgroundByIdOrExternal(req.params.id);
    if (!campground) return res.status(404).json({ error: 'Campground not found' });
    const campgroundId = campground.id;

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const per_page = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 20));
    const sort = req.query.sort || 'newest';
    const commentsOnly = String(req.query.comments_only || 'false') === 'true';
    const includeAggregate = String(req.query.include_aggregate || 'false') === 'true';
    const includeUser = String(req.query.include_user || 'false') === 'true';

    const where = { campground_id: campgroundId, hidden: false };
    if (commentsOnly) {
      where.comment = { [db.sequelize.Op.ne]: null };
    }

    let order = [['created_at', 'DESC']];
    if (sort === 'highest') order = [['rating', 'DESC'], ['created_at', 'DESC']];
    if (sort === 'lowest') order = [['rating', 'ASC'], ['created_at', 'DESC']];

    const include = [];
    if (includeUser) include.push({ model: User, as: 'user', attributes: ['id', 'name', 'avatar_url', 'username'] });

    // optional auth to mark `mine`
    const optUser = await optionalAuthenticate(req);

    const total = await Rating.count({ where });
    const items = await Rating.findAll({ where, include, order, limit: per_page, offset: (page - 1) * per_page });

    const outItems = items.map(r => {
      const plain = r.toJSON();
      const userObj = r.user || null;
      return {
        id: plain.id,
        campground_id: plain.campground_id,
        user_id: plain.user_id,
        user_name: includeUser ? (userObj ? (userObj.name || userObj.username) : plain.anon_name) : undefined,
        user_avatar: includeUser ? (userObj ? userObj.avatar_url : null) : undefined,
        rating: plain.rating,
        comment: plain.comment,
        hidden: plain.hidden,
        created_at: plain.created_at,
        mine: optUser ? (optUser.id && plain.user_id ? Number(optUser.id) === Number(plain.user_id) : false) : false,
      };
    });

    const result = {
      items: outItems,
      pagination: { page, per_page, total }
    };

    if (includeAggregate) {
      const agg = await Rating.findAll({
        attributes: [[db.sequelize.fn('AVG', db.sequelize.col('rating')), 'rating'], [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'review_count']],
        where: { campground_id: campgroundId, hidden: false },
      });
      const ratingAvg = parseFloat(agg[0].get('rating')) || 0.0;
      const count = parseInt(agg[0].get('review_count'), 10) || 0;
      result.aggregate = { rating: Number(ratingAvg.toFixed(2)), review_count: count };
    }

    return res.json(result);
  } catch (e) {
    console.error('[ratings][list] error', e);
    return res.status(500).json({ error: 'internal' });
  }
}

async function createOrUpdateRating(req, res) {
  try {
    const campground = await findCampgroundByIdOrExternal(req.params.id);
    if (!campground) return res.status(404).json({ error: 'Campground not found' });
    const campgroundId = campground.id;

    const body = req.body || {};
    const ratingVal = body.rating;
    const commentRaw = body.comment;
    const anon_name = body.anon_name;

    if (typeof ratingVal === 'undefined') return res.status(400).json({ error: 'validation', details: { rating: 'required' } });
    const ratingInt = parseInt(ratingVal, 10);
    if (isNaN(ratingInt) || ratingInt < 1 || ratingInt > 5) return res.status(400).json({ error: 'validation', details: { rating: 'must be integer 1..5' } });

    const comment = sanitizeComment(commentRaw);

    // optional auth
    const optUser = await optionalAuthenticate(req);
    const userId = optUser ? optUser.id : null;

    if (!userId && !anon_name) {
      // per decision, allow anonymous only if anon_name provided
      return res.status(401).json({ error: 'Authentication required or anon_name must be provided' });
    }

    const camp = await Campground.findByPk(campgroundId);
    if (!camp) return res.status(404).json({ error: 'Campground not found' });

    let created = false;
    let ratingRecord = null;

    await db.sequelize.transaction(async (t) => {
      let existing = null;
      if (userId) existing = await Rating.findOne({ where: { campground_id: campgroundId, user_id: userId }, transaction: t });
      else existing = anon_name ? await Rating.findOne({ where: { campground_id: campgroundId, anon_name }, transaction: t }) : null;

      if (existing) {
        ratingRecord = await existing.update({ rating: ratingInt, comment }, { transaction: t });
      } else {
        ratingRecord = await Rating.create({ campground_id: campgroundId, user_id: userId, anon_name: anon_name || null, rating: ratingInt, comment }, { transaction: t });
        created = true;
      }

      // recalc aggregate
      const agg = await Rating.findAll({
        attributes: [[db.sequelize.fn('AVG', db.sequelize.col('rating')), 'ratingAvg'], [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count']],
        where: { campground_id: campgroundId, hidden: false },
        transaction: t,
      });
      const avg = parseFloat(agg[0].get('ratingAvg')) || 0.0;
      const count = parseInt(agg[0].get('count'), 10) || 0;

      await Campground.update({ rating: avg, review_count: count }, { where: { id: campgroundId }, transaction: t });
      // attach aggregate for response
      ratingRecord = ratingRecord.toJSON();
      ratingRecord.aggregate = { rating: Number(avg.toFixed(2)), review_count: count };
    });

    return res.status(created ? 201 : 200).json({ rating: ratingRecord });
  } catch (e) {
    console.error('[ratings][createOrUpdate] error', e);
    return res.status(500).json({ error: 'internal' });
  }
}

async function deleteMyRating(req, res) {
  try {
    const campground = await findCampgroundByIdOrExternal(req.params.id);
    if (!campground) return res.status(404).json({ error: 'Campground not found' });
    const campgroundId = campground.id;

    const user = req.user;
    if (!user || !user.id) return res.status(401).json({ error: 'Unauthorized' });

    const existing = await Rating.findOne({ where: { campground_id: campgroundId, user_id: user.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    await db.sequelize.transaction(async (t) => {
      await existing.destroy({ transaction: t });

      const agg = await Rating.findAll({
        attributes: [[db.sequelize.fn('AVG', db.sequelize.col('rating')), 'ratingAvg'], [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count']],
        where: { campground_id: campgroundId, hidden: false },
        transaction: t,
      });
      const avg = parseFloat(agg[0].get('ratingAvg')) || 0.0;
      const count = parseInt(agg[0].get('count'), 10) || 0;
      await Campground.update({ rating: avg, review_count: count }, { where: { id: campgroundId }, transaction: t });
    });

    return res.status(204).send();
  } catch (e) {
    console.error('[ratings][delete] error', e);
    return res.status(500).json({ error: 'internal' });
  }
}

async function getSummary(req, res) {
  try {
    const campground = await findCampgroundByIdOrExternal(req.params.id);
    if (!campground) return res.status(404).json({ error: 'Campground not found' });
    const campgroundId = campground.id;

    const agg = await Rating.findAll({
      attributes: [[db.sequelize.fn('AVG', db.sequelize.col('rating')), 'ratingAvg'], [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count']],
      where: { campground_id: campgroundId, hidden: false },
    });
    const avg = parseFloat(agg[0].get('ratingAvg')) || 0.0;
    const count = parseInt(agg[0].get('count'), 10) || 0;
    return res.json({ rating: Number(avg.toFixed(2)), review_count: count });
  } catch (e) {
    console.error('[ratings][summary] error', e);
    return res.status(500).json({ error: 'internal' });
  }
}

async function moderateRating(req, res) {
  try {
    const campground = await findCampgroundByIdOrExternal(req.params.id);
    if (!campground) return res.status(404).json({ error: 'Campground not found' });
    const campgroundId = campground.id;
    const ratingId = parseInt(req.params.ratingId, 10);
    if (isNaN(ratingId)) return res.status(400).json({ error: 'Invalid id' });

    const actingUser = await User.findByPk(req.user && req.user.id);
    if (!actingUser || !(['admin', 'superadmin'].includes(actingUser.role))) return res.status(403).json({ error: 'Forbidden' });

    const body = req.body || {};
    const patch = {};
    if (typeof body.hidden !== 'undefined') patch.hidden = !!body.hidden;
    if (typeof body.moderator_note !== 'undefined') patch.moderator_note = body.moderator_note;
    if (typeof body.rating !== 'undefined') patch.rating = parseInt(body.rating, 10);
    if (typeof body.comment !== 'undefined') patch.comment = sanitizeComment(body.comment);

    const rec = await Rating.findOne({ where: { id: ratingId, campground_id: campgroundId } });
    if (!rec) return res.status(404).json({ error: 'Not found' });

    await db.sequelize.transaction(async (t) => {
      await rec.update(patch, { transaction: t });

      const agg = await Rating.findAll({
        attributes: [[db.sequelize.fn('AVG', db.sequelize.col('rating')), 'ratingAvg'], [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count']],
        where: { campground_id: campgroundId, hidden: false },
        transaction: t,
      });
      const avg = parseFloat(agg[0].get('ratingAvg')) || 0.0;
      const count = parseInt(agg[0].get('count'), 10) || 0;
      await Campground.update({ rating: avg, review_count: count }, { where: { id: campgroundId }, transaction: t });
    });

    const updated = await Rating.findByPk(ratingId);
    return res.json({ rating: updated });
  } catch (e) {
    console.error('[ratings][moderate] error', e);
    return res.status(500).json({ error: 'internal' });
  }
}

async function flagRating(req, res) {
  try {
    const campground = await findCampgroundByIdOrExternal(req.params.id);
    if (!campground) return res.status(404).json({ error: 'Campground not found' });
    const campgroundId = campground.id;
    const ratingId = parseInt(req.params.ratingId, 10);
    if (isNaN(ratingId)) return res.status(400).json({ error: 'Invalid id' });

    const body = req.body || {};
    const reason = body.reason ? String(body.reason).slice(0, 500) : null;

    const rec = await Rating.findOne({ where: { id: ratingId, campground_id: campgroundId } });
    if (!rec) return res.status(404).json({ error: 'Not found' });

    await rec.update({ flagged: true, flag_reason: reason });
    // Optionally log report with IP / UA
    console.log('[ratings][flag] report', { ratingId, campgroundId, reason, ip: req.ip, ua: req.headers['user-agent'] });

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('[ratings][flag] error', e);
    return res.status(500).json({ error: 'internal' });
  }
}

module.exports = {
  listRatings,
  createOrUpdateRating,
  deleteMyRating,
  getSummary,
  moderateRating,
  flagRating,
};
