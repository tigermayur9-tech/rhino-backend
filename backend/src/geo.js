/**
 * Small geo helpers (no external libraries needed).
 */
const EARTH_RADIUS_KM = 6371;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/** Haversine distance between two coordinates, in kilometres. */
function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Rough trip duration estimate: city average ~24 km/h + 2 min handling. */
function estimateDurationMin(km) {
  return (km / 24) * 60 + 2;
}

module.exports = { haversineKm, estimateDurationMin };
