/**
 * Route Service — Gerçek sürüş süresi ve mesafesi
 *
 * Sağlayıcılar (ROUTE_PROVIDER env ile seçilir):
 *   osrm   — Ücretsiz, API key gerektirmez (varsayılan)
 *   google — Google Maps Distance Matrix API (GOOGLE_MAPS_API_KEY gerekli)
 */

const ROUTE_PROVIDER = process.env.ROUTE_PROVIDER || 'osrm';
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

/**
 * @param {{ lat: number, lng: number }} origin
 * @param {{ lat: number, lng: number }} destination
 * @returns {Promise<{ durationMin: number, distanceKm: number, summary: string } | null>}
 */
async function getRouteInfo(origin, destination) {
  if (!origin?.lat || !destination?.lat) return null;

  try {
    if (ROUTE_PROVIDER === 'google' && GOOGLE_MAPS_API_KEY) {
      return await _googleRoute(origin, destination);
    }
    return await _osrmRoute(origin, destination);
  } catch (err) {
    console.warn('[ROUTE] Rota sorgusu başarısız:', err.message);
    return null;
  }
}

/** OSRM — router.project-osrm.org (ücretsiz, Avrupa/Türkiye kapsıyor) */
async function _osrmRoute(origin, dest) {
  const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=false`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: { 'User-Agent': 'KampDefterim/1.0' },
  });

  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const data = await res.json();

  if (data.code !== 'Ok' || !data.routes?.length) return null;

  const route = data.routes[0];
  const durationMin = Math.round(route.duration / 60);
  const distanceKm = parseFloat((route.distance / 1000).toFixed(1));

  return {
    durationMin,
    distanceKm,
    summary: `~${_formatDuration(durationMin)} (${distanceKm} km, trafik hariç)`,
  };
}

/** Google Maps Distance Matrix API */
async function _googleRoute(origin, dest) {
  const params = new URLSearchParams({
    origins: `${origin.lat},${origin.lng}`,
    destinations: `${dest.lat},${dest.lng}`,
    mode: 'driving',
    language: 'tr',
    key: GOOGLE_MAPS_API_KEY,
  });

  const res = await fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?${params}`, {
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) throw new Error(`Google Maps ${res.status}`);
  const data = await res.json();

  const element = data.rows?.[0]?.elements?.[0];
  if (element?.status !== 'OK') return null;

  const durationMin = Math.round(element.duration.value / 60);
  const distanceKm = parseFloat((element.distance.value / 1000).toFixed(1));

  return {
    durationMin,
    distanceKm,
    summary: `~${_formatDuration(durationMin)} (${distanceKm} km, tahmini trafik dahil)`,
  };
}

function _formatDuration(minutes) {
  if (minutes < 60) return `${minutes} dk`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} sa ${m} dk` : `${h} sa`;
}

module.exports = { getRouteInfo };
