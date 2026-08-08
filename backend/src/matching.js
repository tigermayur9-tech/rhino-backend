/**
 * Matching engine — the "secret sauce".
 * Finds the nearest available online driver for a ride request.
 * If the driver doesn't respond in time, we try the next nearest one.
 * If no driver exists yet, we keep retrying until one comes online.
 */
const store = require('./store');
const { haversineKm } = require('./geo');

const MAX_MATCH_RADIUS_KM = 20;   // don't offer rides to drivers farther than this
const REQUEST_TIMEOUT_MS = 30000; // driver has 30s to accept before we move on
const RETRY_DELAY_MS = 4000;      // how often we look again when no driver is free

function findNearestDriver({ lat, lng, excludeIds = [] }) {
  let best = null;
  for (const driver of store.drivers.values()) {
    if (!driver.online || !driver.available) continue;
    if (driver.rideId || driver.pendingRideId) continue;
    if (excludeIds.includes(driver.id)) continue;
    const dist = haversineKm(lat, lng, driver.lat, driver.lng);
    if (dist > MAX_MATCH_RADIUS_KM) continue;
    if (!best || dist < best.dist) best = { driver, dist };
  }
  return best ? best.driver : null;
}

function stopMatching(ride) {
  if (ride.matchQueue && ride.matchQueue.timer) {
    clearTimeout(ride.matchQueue.timer);
    ride.matchQueue.timer = null;
  }
}

function attemptMatch(io, ride) {
  if (ride.status !== 'requested') return;
  if (ride.matchQueue.currentDriverId) return; // already waiting on a driver

  const driver = findNearestDriver({
    lat: ride.pickup.lat,
    lng: ride.pickup.lng,
    excludeIds: ride.matchQueue.tried,
  });

  if (!driver) {
    // Tell the rider once that nobody is available yet; keep retrying.
    if (ride.matchQueue.tried.length === 0) {
      io.to(ride.riderSocketId).emit('ride:no_drivers', { rideId: ride.id });
    }
    ride.matchQueue.timer = setTimeout(() => attemptMatch(io, ride), RETRY_DELAY_MS);
    return;
  }

  driver.pendingRideId = ride.id;
  driver.available = false;
  ride.matchQueue.tried.push(driver.id);
  ride.matchQueue.currentDriverId = driver.id;

  // Rough ETA for the driver to reach pickup (~27 km/h through city streets).
  const etaMin = Math.max(
    1,
    Math.round(haversineKm(driver.lat, driver.lng, ride.pickup.lat, ride.pickup.lng) / 0.45)
  );

  io.to(`driver:${driver.id}`).emit('ride:request', {
    rideId: ride.id,
    rider: ride.rider,
    pickup: ride.pickup,
    dropoff: ride.dropoff,
    vehicleType: ride.vehicleType,
    fare: ride.fare,
    etaMin,
  });

  ride.matchQueue.timer = setTimeout(() => {
    const d = store.drivers.get(driver.id);
    if (d && d.pendingRideId === ride.id) {
      d.pendingRideId = null;
      d.available = true;
    }
    if (ride.matchQueue.currentDriverId === driver.id) ride.matchQueue.currentDriverId = null;
    if (ride.status === 'requested') attemptMatch(io, ride);
  }, REQUEST_TIMEOUT_MS);
}

function startMatching(io, ride) {
  ride.matchQueue = { tried: [], currentDriverId: null, timer: null };
  attemptMatch(io, ride);
}

function cancelMatching(io, ride) {
  stopMatching(ride);
}

/** When a new driver comes online, pick up any riders still waiting. */
function tryMatchWaitingRides(io) {
  for (const ride of store.rides.values()) {
    if (ride.status === 'requested' && ride.matchQueue && !ride.matchQueue.currentDriverId) {
      attemptMatch(io, ride);
    }
  }
}

module.exports = {
  findNearestDriver,
  startMatching,
  stopMatching,
  cancelMatching,
  attemptMatch,
  tryMatchWaitingRides,
};
