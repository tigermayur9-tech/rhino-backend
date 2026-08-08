/**
 * Pricing engine — base fare + distance + time + service fee, per vehicle type.
 * Tune the rates here to change how much rides cost.
 */
const VEHICLES = {
  ride: {
    id: 'ride',
    name: 'Ride',
    base: 1.2,
    perKm: 0.9,
    perMin: 0.15,
    seats: 4,
    blurb: 'Affordable everyday rides',
  },
  comfort: {
    id: 'comfort',
    name: 'Comfort',
    base: 1.8,
    perKm: 1.3,
    perMin: 0.22,
    seats: 4,
    blurb: 'Newer cars with extra legroom',
  },
  xl: {
    id: 'xl',
    name: 'XL',
    base: 2.5,
    perKm: 1.8,
    perMin: 0.3,
    seats: 6,
    blurb: 'SUVs and vans for groups',
  },
};

const SERVICE_FEE_RATE = 0.12; // 12% booking fee

function round2(n) {
  return Math.round(n * 100) / 100;
}

function estimateFare({ distanceKm, durationMin, vehicleType }) {
  const v = VEHICLES[vehicleType] || VEHICLES.ride;
  const distanceFare = distanceKm * v.perKm;
  const timeFare = durationMin * v.perMin;
  const subtotal = v.base + distanceFare + timeFare;
  const serviceFee = subtotal * SERVICE_FEE_RATE;
  const total = subtotal + serviceFee;
  return {
    vehicleType: v.id,
    vehicleName: v.name,
    seats: v.seats,
    blurb: v.blurb,
    base: round2(v.base),
    distance: round2(distanceFare),
    time: round2(timeFare),
    serviceFee: round2(serviceFee),
    total: round2(total),
    currency: 'USD',
  };
}

function allFares({ distanceKm, durationMin }) {
  return Object.keys(VEHICLES).map((vehicleType) =>
    estimateFare({ distanceKm, durationMin, vehicleType })
  );
}

module.exports = { VEHICLES, estimateFare, allFares };
