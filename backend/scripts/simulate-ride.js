/**
 * Simulate a complete ride automatically — no phones needed.
 * A fake driver goes online, a fake rider books a ride, the driver
 * accepts and walks through the whole trip (arrived -> started -> completed).
 *
 * Run with:  npm run simulate   (while the server is running)
 */
const { io } = require('socket.io-client');

const URL = process.env.BACKEND_URL || 'http://localhost:4000';
const log = (who, msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${who}: ${msg}`);

const driver = io(URL, { transports: ['websocket'] });
const rider = io(URL, { transports: ['websocket'] });

const driverId = 'D-SIM';
const riderId = 'R-SIM';
const PICKUP = { lat: 37.7749, lng: -122.4194 }; // San Francisco
const DROPOFF = { lat: 37.7815, lng: -122.4048 };

let rideId = null;

const fail = (msg) => {
  console.error('❌ FAIL:', msg);
  process.exit(1);
};

const timeout = setTimeout(
  () => fail('timed out waiting for the ride to complete (is the server running?)'),
  20000
);
process.on('exit', () => clearTimeout(timeout));

driver.on('connect', () => {
  log('driver', 'connected — going online near the pickup point');
  driver.emit('driver:online', {
    driverId,
    name: 'Sim Driver',
    vehicleType: 'ride',
    vehicle: { make: 'Toyota', model: 'Camry', color: 'White', plate: 'SIM 123' },
    lat: PICKUP.lat + 0.01,
    lng: PICKUP.lng + 0.01,
  });
});

driver.on('ride:request', (data) => {
  log(
    'driver',
    `📲 RIDE REQUEST ${data.rideId} — $${data.fare.total} (ETA ${data.etaMin} min). Accepting…`
  );
  rideId = data.rideId;
  setTimeout(() => driver.emit('driver:accept', { rideId }), 500);
});

driver.on('ride:accepted', () => {
  log('driver', 'ride accepted — simulating the trip…');
  setTimeout(() => driver.emit('driver:location', { driverId, lat: PICKUP.lat + 0.004, lng: PICKUP.lng + 0.004 }), 800);
  setTimeout(() => driver.emit('driver:arrived', { rideId }), 1500);
  setTimeout(() => driver.emit('driver:start', { rideId }), 2500);
  setTimeout(
    () =>
      driver.emit('driver:location', {
        driverId,
        lat: (PICKUP.lat + DROPOFF.lat) / 2,
        lng: (PICKUP.lng + DROPOFF.lng) / 2,
      }),
    3500
  );
  setTimeout(() => driver.emit('driver:complete', { rideId }), 4500);
});

rider.on('connect', () => {
  log('rider', 'connected — requesting a ride');
  rider.emit('rider:request', { riderId, name: 'Sim Rider', pickup: PICKUP, dropoff: DROPOFF, vehicleType: 'ride' });
});

rider.on('ride:created', (d) =>
  log('rider', `ride created ${d.rideId} — ${d.distanceKm.toFixed(2)} km, ~${d.durationMin.toFixed(0)} min, fare $${d.fare.total}`)
);

rider.on('ride:accepted', (d) =>
  log('rider', `✅ driver accepted — ${d.driver.name} in a ${d.driver.vehicle.color} ${d.driver.vehicle.make} ${d.driver.vehicle.model}, ETA ${d.ride.etaMin} min`)
);

rider.on('driver:location_update', (d) =>
  log('rider', `📍 driver moved to ${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}`)
);

rider.on('ride:arriving', () => log('rider', '🚩 driver arrived at pickup'));
rider.on('ride:in_progress', () => log('rider', '🏁 trip started'));
rider.on('ride:completed', (d) => {
  log('rider', `🎉 RIDE COMPLETE — total $${d.ride.fare.total}. Rating driver 5 stars…`);
  rider.emit('ride:rate', { rideId, rating: 5 });
  setTimeout(() => {
    log('rider', 'all done — shutting down.');
    process.exit(0);
  }, 300);
});
