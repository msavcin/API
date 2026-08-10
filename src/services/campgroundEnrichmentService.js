const axios = require('axios');

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
const GOOGLE_PLACES_SEARCH_URL = 'https://maps.googleapis.com/maps/api/place/findplacefromtext/json';
const GOOGLE_PLACES_DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json';

const OFFICIAL_TOURISM_PORTALS = [
  {
    name: 'GoTurkey',
    baseUrl: 'https://www.goturkiye.com',
    searchPath: '/tr/search',
    queryParam: 'q',
  },
  {
    name: 'Kültür ve Turizm Bakanlığı',
    baseUrl: 'https://www.kultur.gov.tr',
    searchPath: '/tr/arama',
    queryParam: 'search',
  },
];

function _normalizeUrl(value) {
  if (!value || typeof value !== 'string') return null;
  let urlValue = value.trim();
  if (!urlValue.match(/^https?:\/\//i)) {
    urlValue = `https://${urlValue}`;
  }
  return urlValue;
}

function _normalizePhone(value) {
  if (!value || typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function extractSocialMediaLinks(text) {
  if (!text || typeof text !== 'string') return {};
  const result = {};
  const normalized = text.replace(/&quot;|&ldquo;|&rdquo;/g, '"');
  const patterns = {
    instagram: /https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9._\-\/]+/gi,
    whatsapp: /https?:\/\/(?:www\.)?whatsapp\.com\/send\?[^\s"']+|https?:\/\/wa\.me\/[0-9+]+/gi,
    facebook: /https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9._\-\/]+/gi,
    youtube: /https?:\/\/(?:www\.)?youtube\.com\/[A-Za-z0-9._\-\/]+/gi,
    tiktok: /https?:\/\/(?:www\.)?tiktok\.com\/[A-Za-z0-9._\-\/]+/gi,
    linkedin: /https?:\/\/(?:www\.)?linkedin\.com\/[A-Za-z0-9._\-\/]+/gi,
    email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    tel: /tel:[+0-9\-()\s\.]+/gi,
  };

  Object.entries(patterns).forEach(([key, regex]) => {
    const matches = normalized.match(regex);
    if (matches?.length) {
      result[key] = matches[0];
    }
  });
  return result;
}

function _mergeSocialMedia(existing, incoming) {
  if (!incoming || typeof incoming !== 'object') return existing;
  const existingObj = typeof existing === 'string' ? _parseJson(existing) : existing || {};
  return {
    ...existingObj,
    ...incoming,
  };
}

function _parseJson(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch (err) {
    return null;
  }
}

function _toAbsoluteUrl(href, baseUrl) {
  if (!href || typeof href !== 'string') return null;
  try {
    return new URL(href, baseUrl).href;
  } catch (err) {
    return null;
  }
}

function _extractSearchResultUrls(html, baseUrl) {
  const urls = [];
  const anchorPattern = /<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(html)) !== null) {
    let href = match[1];
    if (href.toLowerCase().startsWith('javascript:')) continue;
    const absolute = _toAbsoluteUrl(href, baseUrl);
    if (absolute && !urls.includes(absolute)) {
      urls.push(absolute);
    }
  }
  return urls;
}

function _pickBestSearchResult(urls, name) {
  if (!urls?.length) return null;
  const normalizedName = name ? name.toLowerCase().replace(/[^a-z0-9ğüşöçıİĞÜŞÖÇ\s]/gi, '') : '';
  for (const url of urls) {
    if (/search|arama|sorgu|q=/.test(url.toLowerCase())) continue;
    if (normalizedName && url.toLowerCase().includes(normalizedName.split(' ').filter(Boolean)[0])) {
      return url;
    }
  }
  return urls[0];
}

function extractContactDetails(html) {
  const details = {};
  if (typeof html !== 'string') return details;

  const emailMatch = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) details.email = emailMatch[0];

  const telMatch = html.match(/(?:tel:|telefon(?:\s*[:])?|phone(?:\s*[:])?|call(?:\s*[:])?)[^\d\+]*(\+?[0-9][0-9\s().-]{6,}[0-9])/i);
  if (telMatch) details.phone = telMatch[1].trim();

  const whatsappMatch = html.match(/https?:\/\/(?:www\.)?wa\.me\/[0-9+]+|https?:\/\/(?:www\.)?whatsapp\.com\/send\?[^"]+/i);
  if (whatsappMatch) {
    details.whatsapp = whatsappMatch[0];
  }

  return details;
}

function _buildEnrichmentPatch(existing, candidate) {
  const patch = {};
  const shouldOverwrite = (field) => {
    const existingValue = existing[field];
    if (field === 'rating' || field === 'review_count') {
      return candidate[field] !== undefined && candidate[field] !== null && Number(candidate[field]) > Number(existingValue || 0);
    }
    return (existingValue === undefined || existingValue === null || existingValue === '' || existingValue === 0) && candidate[field] !== undefined && candidate[field] !== null && candidate[field] !== '';
  };

  const writable = [
    'website', 'phone', 'opening_hours', 'capacity', 'fee', 'price_range', 'booking_url', 'contact_email', 'description',
  ];

  writable.forEach((field) => {
    if (shouldOverwrite(field)) {
      patch[field] = candidate[field];
    }
  });

  if (shouldOverwrite('rating')) patch.rating = Number(candidate.rating);
  if (shouldOverwrite('review_count')) patch.review_count = Number(candidate.review_count);

  // Google kaynaklı puan/veri varsa özel google_* alanlarına da yaz
  if (candidate.google_rating !== undefined && candidate.google_rating !== null) {
    patch.google_rating = Number(candidate.google_rating);
  }
  if (candidate.google_review_count !== undefined && candidate.google_review_count !== null) {
    patch.google_review_count = Number(candidate.google_review_count);
  }

  if (candidate.social_media) {
    const merged = _mergeSocialMedia(existing.social_media, candidate.social_media);
    if (merged && Object.keys(merged).length) patch.social_media = JSON.stringify(merged);
  }

  if (candidate.website && !patch.booking_url && !existing.booking_url) {
    patch.booking_url = candidate.website;
  }

  if (!patch.last_verified) {
    patch.last_verified = new Date().toISOString();
  }

  return patch;
}

async function _fetchHtml(urlToFetch) {
  try {
    const response = await axios.get(urlToFetch, {
      timeout: 12000,
      headers: { 'User-Agent': 'KampDefterim/1.0 (+https://github.com)' },
    });
    return response.data;
  } catch (err) {
    return null;
  }
}

function _parseMetaTags(html) {
  const metadata = {};
  const tagPattern = /<meta[^>]+(property|name)=["']([^"']+)["'][^>]+content=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = tagPattern.exec(html)) !== null) {
    const key = match[2].toLowerCase();
    const value = match[3].trim();
    if (key.includes('title')) metadata.title = metadata.title || value;
    if (key.includes('description')) metadata.description = metadata.description || value;
    if (key.includes('image')) metadata.image = metadata.image || value;
    if (key.includes('url')) metadata.url = metadata.url || value;
  }
  return metadata;
}

async function fetchWebsiteMetadata(websiteUrl) {
  const normalizedUrl = _normalizeUrl(websiteUrl);
  if (!normalizedUrl) return null;

  const html = await _fetchHtml(normalizedUrl);
  if (!html) return null;

  const social_media = extractSocialMediaLinks(html);
  const metadata = _parseMetaTags(html);
  const contactDetails = extractContactDetails(html);
  return {
    website: normalizedUrl,
    social_media: social_media && Object.keys(social_media).length ? social_media : null,
    description: metadata.description || null,
    booking_url: metadata.url || normalizedUrl,
    phone: contactDetails.phone || null,
    contact_email: contactDetails.email || null,
    whatsapp: contactDetails.whatsapp || null,
  };
}

async function fetchGooglePlaceDetails({ name, latitude, longitude }) {
  if (!GOOGLE_PLACES_API_KEY || !name || latitude === undefined || longitude === undefined) {
    return null;
  }

  try {
    const searchRes = await axios.get(GOOGLE_PLACES_SEARCH_URL, {
      timeout: 12000,
      params: {
        key: GOOGLE_PLACES_API_KEY,
        input: name,
        inputtype: 'textquery',
        fields: 'place_id,formatted_address,name',
        locationbias: `point:${latitude},${longitude}`,
      },
    });

    const candidate = searchRes.data?.candidates?.[0];
    if (!candidate?.place_id) return null;

    const detailRes = await axios.get(GOOGLE_PLACES_DETAILS_URL, {
      timeout: 12000,
      params: {
        key: GOOGLE_PLACES_API_KEY,
        place_id: candidate.place_id,
        fields: 'place_id,name,formatted_phone_number,international_phone_number,formatted_address,website,url,rating,user_ratings_total,opening_hours,types'
      },
    });

    const place = detailRes.data?.result;
    if (!place) return null;

    const socialMedia = await (async () => {
      if (place.website) {
        const metadata = await fetchWebsiteMetadata(place.website);
        return metadata?.social_media || null;
      }
      return null;
    })();

    return {
      external_id: place.place_id,
      website: place.website || null,
      booking_url: place.url || place.website || null,
      phone: _normalizePhone(place.formatted_phone_number || place.international_phone_number),
      google_rating: place.rating ? parseFloat(place.rating) : null,
      google_review_count: place.user_ratings_total || null,
      opening_hours: place.opening_hours?.weekday_text ? JSON.stringify(place.opening_hours.weekday_text) : null,
      description: place.formatted_address || null,
      social_media: socialMedia,
    };
  } catch (err) {
    return null;
  }
}

async function searchOfficialTourismPortals(name, province) {
  if (!name) return null;

  const query = encodeURIComponent(name);
  for (const portal of OFFICIAL_TOURISM_PORTALS) {
    const searchUrl = `${portal.baseUrl}${portal.searchPath}?${portal.queryParam}=${query}`;
    const html = await _fetchHtml(searchUrl);
    if (!html) continue;

    const resultUrls = _extractSearchResultUrls(html, portal.baseUrl);
    const candidateUrl = _pickBestSearchResult(resultUrls, name);
    if (candidateUrl) {
      const detailHtml = await _fetchHtml(candidateUrl);
      if (detailHtml) {
        const metadata = _parseMetaTags(detailHtml);
        const social_media = extractSocialMediaLinks(detailHtml);
        const contactDetails = extractContactDetails(detailHtml);
        return {
          website: candidateUrl,
          description: metadata.description || metadata.title || null,
          social_media: Object.keys(social_media).length ? social_media : null,
          booking_url: candidateUrl,
          phone: contactDetails.phone || null,
          contact_email: contactDetails.email || null,
          whatsapp: contactDetails.whatsapp || null,
        };
      }
    }

    const openGraph = _parseMetaTags(html);
    const social_media = extractSocialMediaLinks(html);
    const contactDetails = extractContactDetails(html);
    if (openGraph.title || openGraph.description || Object.keys(social_media).length || contactDetails.phone || contactDetails.email) {
      return {
        website: portal.baseUrl,
        description: openGraph.description || openGraph.title || null,
        social_media: Object.keys(social_media).length ? social_media : null,
        booking_url: openGraph.url || searchUrl,
        phone: contactDetails.phone || null,
        contact_email: contactDetails.email || null,
        whatsapp: contactDetails.whatsapp || null,
      };
    }
  }
  return null;
}

async function enrichCampgroundData(campground, options = {}) {
  if (!campground || !campground.id) return null;

  const sources = options.sources || ['google', 'website', 'tourism_portals'];
  const patches = [];

  if (sources.includes('google')) {
    const googleData = await fetchGooglePlaceDetails({
      name: campground.name,
      latitude: campground.latitude,
      longitude: campground.longitude,
    });
    if (googleData) patches.push(googleData);
  }

  if (sources.includes('website') && campground.website) {
    const websiteData = await fetchWebsiteMetadata(campground.website);
    if (websiteData) patches.push(websiteData);
  }

  if (sources.includes('tourism_portals')) {
    const portalData = await searchOfficialTourismPortals(campground.name, campground.province);
    if (portalData) patches.push(portalData);
  }

  const mergedCandidate = patches.reduce((acc, patch) => ({ ...acc, ...patch }), {});
  const update = _buildEnrichmentPatch(campground, mergedCandidate);
  return Object.keys(update).length ? update : null;
}

module.exports = {
  enrichCampgroundData,
  fetchGooglePlaceDetails,
  fetchWebsiteMetadata,
  searchOfficialTourismPortals,
  extractSocialMediaLinks,
};
