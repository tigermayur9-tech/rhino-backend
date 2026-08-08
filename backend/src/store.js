/**
 * In-memory data store.
 * For the MVP everything lives in memory (resets when the server restarts).
 * Later you can swap this for a real database (PostgreSQL, MongoDB, …).
 */
const drivers = new Map(); // driverId -> driver
const riders = new Map();  // riderId -> rider
const rides = new Map();   // rideId -> ride

const round2 = (n) => Math.round(n * 100) / 100;

const ACTIVE_STATUSES = ['requested', 'accepted', 'arriving', 'in_progress'];

function driversOnlineCount() {
  let count = 0;
  for (const d of drivers.values()) if (d.online) count += 1;
  return count;
}

function activeRideCount() {
  let count = 0;
  for (const r of rides.values()) if (ACTIVE_STATUSES.includes(r.status)) count += 1;
  return count;
}

function stats() {
  const byStatus = {};
  for (const r of rides.values()) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  return {
    driversOnline: driversOnlineCount(),
    drivers: drivers.size,
    riders: riders.size,
    totalRides: rides.size,
    activeRides: activeRideCount(),
    ridesByStatus: byStatus,
  };
}

module.exports = { drivers, riders, rides, round2, driversOnlineCount, activeRideCount, stats };
