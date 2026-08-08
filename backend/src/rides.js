/**
 * Ride model + lifecycle helpers.
 */
const store = require('./store');
const { estimateFare } = require('./fares');
const { haversineKm, estimateDurationMin } = require('./geo');

function createRide({ rider, riderSocketId, pickup, dropoff, vehicleType }) {
  const distanceKm = haversineKm(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng);
  const durationMin = estimateDurationMin(distanceKm);
  const fare = estimateFare({ distanceKm, durationMin, vehicleType });

  const ride = {
    id: `R-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 9000 + 1000)}`,
    status: 'requested',
    rider: { id: rider.id, name: rider.name },
    riderSocketId,
    driver: null,
    driverSocketId: null,
    pickup,
    dropoff,
    vehicleType,
    distanceKm: store.round2(distanceKm),
    durationMin: store.round2(durationMin),
    fare,
    timestamps: { requested: Date.now() },
    rating: null,
    matchQueue: null,
  };
  store.rides.set(ride.id, ride);
  return ride;
}

function assignDriver(ride, driver) {
  ride.driver = {
    id: driver.id,
    name: driver.name,
    vehicleType: driver.vehicleType,
    vehicle: driver.vehicle,
    lat: driver.lat,
    lng: driver.lng,
  };
  ride.driverSocketId = driver.socketId;
  ride.status = 'accepted';
  ride.timestamps.accepted = Date.now();
  driver.rideId = ride.id;
  driver.pendingRideId = null;
  driver.available = false;
  return ride;
}

function cancelRide(ride, reason) {
  ride.status = 'cancelled';
  ride.cancelReason = reason;
  ride.timestamps.cancelled = Date.now();
  return ride;
}

module.exports = { createRide, assignDriver, cancelRide };
