/**
 * Realtime event wiring (Socket.io).
 *
 * Client -> server:
 *   driver:online / driver:location / driver:offline
 *   driver:accept / driver:decline / driver:arrived / driver:start / driver:complete
 *   rider:request / rider:cancel / ride:rate
 *
 * Server -> client:
 *   driver:online_ok        (driver app — confirms it's online)
 *   ride:request            (driver app — a ride needs a driver)
 *   ride:accepted           (both)
 *   ride:no_drivers         (rider app — nobody available, still retrying)
 *   driver:location_update  (rider app — live driver marker)
 *   ride:arriving / ride:in_progress / ride:completed / ride:cancelled (both)
 *   ride:created / ride:error (rider app)
 */
const store = require('./store');
const { createRide, assignDriver, cancelRide } = require('./rides');
const {
  startMatching,
  stopMatching,
  cancelMatching,
  attemptMatch,
  tryMatchWaitingRides,
} = require('./matching');
const { haversineKm } = require('./geo');

function uid(prefix) {
  return prefix + Math.random().toString(36).slice(2, 8).toUpperCase();
}

module.exports = function registerSockets(io) {
  io.on('connection', (socket) => {
    /* ------------------------------ DRIVER ------------------------------ */

    socket.on('driver:online', (payload = {}) => {
      const id = payload.driverId || uid('D');
      const driver = {
        id,
        socketId: socket.id,
        name: payload.name || 'Driver',
        vehicleType: payload.vehicleType || 'ride',
        vehicle:
          payload.vehicle || { make: 'Toyota', model: 'Corolla', color: 'Black', plate: 'ABC123' },
        lat: payload.lat,
        lng: payload.lng,
        online: true,
        available: true,
        rideId: null,
        pendingRideId: null,
        trips: 0,
        earnings: 0,
        ratingSum: 0,
        ratingCount: 0,
      };
      store.drivers.set(id, driver);
      socket.join(`driver:${id}`);
      socket.emit('driver:online_ok', { driverId: id, driver });
      tryMatchWaitingRides(io); // a rider may already be waiting
      console.log(`[driver] ${driver.name} (${id}) online at ${driver.lat},${driver.lng}`);
    });

    socket.on('driver:location', ({ driverId, lat, lng } = {}) => {
      const driver = store.drivers.get(driverId);
      if (!driver || typeof lat !== 'number' || typeof lng !== 'number') return;
      driver.lat = lat;
      driver.lng = lng;
      if (driver.rideId) {
        const ride = store.rides.get(driver.rideId);
        if (ride) {
          io.to(ride.riderSocketId).emit('driver:location_update', {
            rideId: ride.id,
            lat,
            lng,
          });
        }
      }
    });

    socket.on('driver:offline', ({ driverId } = {}) => {
      const driver = store.drivers.get(driverId);
      if (!driver) return;
      driver.online = false;
      driver.available = false;
      if (driver.pendingRideId) {
        const ride = store.rides.get(driver.pendingRideId);
        if (ride && ride.status === 'requested' && ride.matchQueue) {
          if (ride.matchQueue.currentDriverId === driver.id) {
            ride.matchQueue.currentDriverId = null;
            stopMatching(ride);
            attemptMatch(io, ride);
          }
        }
        driver.pendingRideId = null;
      }
      console.log(`[driver] ${driver.name} (${driver.id}) offline`);
    });

    socket.on('driver:accept', ({ rideId } = {}) => {
      const ride = store.rides.get(rideId);
      if (!ride || ride.status !== 'requested') return;
      const driver = store.drivers.get(ride.matchQueue && ride.matchQueue.currentDriverId);
      if (!driver || driver.socketId !== socket.id) return;
      stopMatching(ride);
      assignDriver(ride, driver);
      const etaMin = Math.max(
        1,
        Math.round(haversineKm(driver.lat, driver.lng, ride.pickup.lat, ride.pickup.lng) / 0.45)
      );
      const driverView = { ...ride, etaMin };
      io.to(ride.riderSocketId).emit('ride:accepted', {
        ride: driverView,
        driver: {
          id: driver.id,
          name: driver.name,
          vehicle: driver.vehicle,
          vehicleType: driver.vehicleType,
          lat: driver.lat,
          lng: driver.lng,
        },
      });
      socket.emit('ride:accepted', { ride: driverView, rider: ride.rider });
      console.log(`[ride] ${ride.id} accepted by ${driver.name} (ETA ${etaMin} min)`);
    });

    socket.on('driver:decline', ({ rideId } = {}) => {
      const ride = store.rides.get(rideId);
      if (!ride || ride.status !== 'requested') return;
      const driver = store.drivers.get(ride.matchQueue && ride.matchQueue.currentDriverId);
      if (driver) {
        driver.pendingRideId = null;
        driver.available = true;
      }
      if (ride.matchQueue) ride.matchQueue.currentDriverId = null;
      stopMatching(ride);
      attemptMatch(io, ride); // try the next nearest driver
    });

    socket.on('driver:arrived', ({ rideId } = {}) => {
      const ride = store.rides.get(rideId);
      if (!ride || ride.driverSocketId !== socket.id || ride.status !== 'accepted') return;
      ride.status = 'arriving';
      ride.timestamps.arriving = Date.now();
      io.to(ride.riderSocketId).emit('ride:arriving', { ride });
      socket.emit('ride:arriving', { ride });
    });

    socket.on('driver:start', ({ rideId } = {}) => {
      const ride = store.rides.get(rideId);
      if (!ride || ride.driverSocketId !== socket.id || ride.status !== 'arriving') return;
      ride.status = 'in_progress';
      ride.timestamps.in_progress = Date.now();
      io.to(ride.riderSocketId).emit('ride:in_progress', { ride });
      socket.emit('ride:in_progress', { ride });
    });

    socket.on('driver:complete', ({ rideId } = {}) => {
      const ride = store.rides.get(rideId);
      if (!ride || ride.driverSocketId !== socket.id || ride.status !== 'in_progress') return;
      ride.status = 'completed';
      ride.timestamps.completed = Date.now();
      const driver = store.drivers.get(ride.driver.id);
      if (driver) {
        driver.trips += 1;
        driver.earnings = store.round2(driver.earnings + ride.fare.total);
        driver.rideId = null;
        driver.available = true;
      }
      io.to(ride.riderSocketId).emit('ride:completed', { ride });
      socket.emit('ride:completed', { ride });
      console.log(
        `[ride] ${ride.id} completed — fare $${ride.fare.total} (${driver ? driver.name : 'driver gone'})`
      );
    });

    /* ------------------------------- RIDER ------------------------------ */

    socket.on('rider:request', (payload = {}) => {
      const { riderId, name, pickup, dropoff, vehicleType } = payload;
      const valid =
        pickup &&
        dropoff &&
        typeof pickup.lat === 'number' &&
        typeof pickup.lng === 'number' &&
        typeof dropoff.lat === 'number' &&
        typeof dropoff.lng === 'number';
      if (!valid) {
        return socket.emit('ride:error', {
          message: 'Pickup and drop-off locations are required',
        });
      }
      const id = riderId || uid('R');
      store.riders.set(id, { id, name: name || 'Rider', socketId: socket.id });
      const ride = createRide({
        rider: { id, name: name || 'Rider' },
        riderSocketId: socket.id,
        pickup,
        dropoff,
        vehicleType,
      });
      startMatching(io, ride);
      socket.emit('ride:created', {
        rideId: ride.id,
        distanceKm: ride.distanceKm,
        durationMin: ride.durationMin,
        fare: ride.fare,
        status: ride.status,
      });
      console.log(
        `[ride] ${ride.id} requested ${ride.pickup.lat},${ride.pickup.lng} -> ${ride.dropoff.lat},${ride.dropoff.lng} (${ride.vehicleType})`
      );
    });

    socket.on('rider:cancel', ({ rideId } = {}) => {
      const ride = store.rides.get(rideId);
      if (!ride || ride.riderSocketId !== socket.id) return;
      if (!['requested', 'accepted', 'arriving'].includes(ride.status)) return;
      cancelMatching(io, ride);
      const driver = ride.driver ? store.drivers.get(ride.driver.id) : null;
      if (driver) {
        driver.rideId = null;
        driver.available = true;
        driver.pendingRideId = null;
      }
      cancelRide(ride, 'rider_cancelled');
      io.to(ride.riderSocketId).emit('ride:cancelled', { rideId: ride.id, reason: 'rider_cancelled' });
      if (ride.driverSocketId) {
        io.to(ride.driverSocketId).emit('ride:cancelled', { rideId: ride.id, reason: 'rider_cancelled' });
      }
      console.log(`[ride] ${ride.id} cancelled by rider`);
    });

    socket.on('ride:rate', ({ rideId, rating } = {}) => {
      const ride = store.rides.get(rideId);
      if (!ride || ride.status !== 'completed' || !rating) return;
      ride.rating = Math.max(1, Math.min(5, Math.round(rating)));
      const driver = store.drivers.get(ride.driver && ride.driver.id);
      if (driver) {
        driver.ratingSum = (driver.ratingSum || 0) + ride.rating;
        driver.ratingCount = (driver.ratingCount || 0) + 1;
      }
    });

    /* ----------------------------- CLEANUP ------------------------------ */

    socket.on('disconnect', () => {
      // Driver left
      for (const [id, d] of store.drivers) {
        if (d.socketId !== socket.id) continue;
        d.online = false;
        d.available = false;
        if (d.pendingRideId) {
          const ride = store.rides.get(d.pendingRideId);
          if (ride && ride.status === 'requested' && ride.matchQueue) {
            if (ride.matchQueue.currentDriverId === d.id) {
              ride.matchQueue.currentDriverId = null;
              stopMatching(ride);
              attemptMatch(io, ride);
            }
          }
          d.pendingRideId = null;
        }
        if (d.rideId) {
          const ride = store.rides.get(d.rideId);
          if (ride && ['accepted', 'arriving', 'in_progress'].includes(ride.status)) {
            cancelRide(ride, 'driver_disconnected');
            io.to(ride.riderSocketId).emit('ride:cancelled', {
              rideId: ride.id,
              reason: 'driver_disconnected',
            });
          }
          d.rideId = null;
        }
        console.log(`[driver] ${d.name} (${id}) disconnected`);
        store.drivers.delete(id);
      }
      // Rider left
      for (const [id, r] of store.riders) {
        if (r.socketId === socket.id) store.riders.delete(id);
      }
    });
  });
};
