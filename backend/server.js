/**
 * Rhino backend server
 * -----------------------
 * Express HTTP API + Socket.io realtime ride-matching.
 *
 * The "brain" of the app:
 *  - Riders request rides -> we find the nearest available driver
 *  - Drivers go online, get ride requests, accept/decline
 *  - Live ride lifecycle: requested -> accepted -> arriving -> in_progress -> completed
 *
 * Run with:  npm start   (listens on http://localhost:4000)
 */
const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const store = require('./src/store');
const { VEHICLES, allFares } = require('./src/fares');

const app = express();
app.use(cors());
app.use(express.json());

/* ---------- HTTP endpoints (used by the app for fares, and for quick checks) ---------- */

// Privacy policy page (required by Google Play & the App Store for location apps).
app.get('/privacy', (_req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'privacy.html'));
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    uptimeSec: Math.round(process.uptime()),
    driversOnline: store.driversOnlineCount(),
    activeRides: store.activeRideCount(),
  });
});

app.get('/api/vehicles', (_req, res) => {
  res.json(Object.values(VEHICLES));
});

// POST /api/fare  body: { distanceKm: number, durationMin: number }
// Returns a fare breakdown for every vehicle type.
app.post('/api/fare', (req, res) => {
  const { distanceKm, durationMin } = req.body || {};
  if (typeof distanceKm !== 'number' || typeof durationMin !== 'number') {
    return res.status(400).json({ error: 'Body must include distanceKm and durationMin (numbers)' });
  }
  res.json(allFares({ distanceKm, durationMin }));
});

app.get('/api/stats', (_req, res) => {
  res.json(store.stats());
});

/* ---------- Realtime layer ---------- */

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

require('./src/sockets')(io);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🦏 Rhino backend running on http://localhost:${PORT}`);
  console.log(`   Health check:  curl http://localhost:${PORT}/health`);
});
