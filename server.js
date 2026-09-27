// server.js
// This server does NOT touch any video/audio. It only helps browsers
// find each other and exchange the messages they need to set up a
// direct WebRTC connection ("signaling").

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve the frontend (public/index.html, client.js, style.css)
app.use(express.static(path.join(__dirname, 'public')));

// Keep track of who is in which room, just for logging/cleanup.
// rooms = { roomId: Set(socketId, socketId, ...) }
const rooms = {};

io.on('connection', (socket) => {
  console.log('client connected:', socket.id);

  // 1) A client wants to join a call room
  socket.on('join-room', (roomId, displayName) => {
    socket.join(roomId);
    socket.displayName = displayName || 'Guest';

    if (!rooms[roomId]) rooms[roomId] = new Set();

    // Tell the NEW client who is already in the room (id + name),
    // so it knows which peer connections to create.
    const existingPeers = Array.from(rooms[roomId]).map((id) => ({
      id,
      name: io.sockets.sockets.get(id)?.displayName || 'Guest'
    }));
    socket.emit('existing-peers', existingPeers);

    rooms[roomId].add(socket.id);
    socket.roomId = roomId;

    // Tell everyone already in the room that a new peer joined,
    // so THEY can create a peer connection toward the new client too.
    socket.to(roomId).emit('peer-joined', { id: socket.id, name: socket.displayName });

    console.log(`${socket.id} (${socket.displayName}) joined room ${roomId} (${rooms[roomId].size} total)`);
  });

  // 2) Relay a WebRTC offer to one specific peer
  socket.on('offer', ({ to, offer }) => {
    io.to(to).emit('offer', { from: socket.id, offer });
  });

  // 3) Relay a WebRTC answer to one specific peer
  socket.on('answer', ({ to, answer }) => {
    io.to(to).emit('answer', { from: socket.id, answer });
  });

  // 4) Relay ICE candidates (network connectivity info) to one specific peer
  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', { from: socket.id, candidate });
  });

  // 5) Clean up when someone disconnects
  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      rooms[roomId].delete(socket.id);
      if (rooms[roomId].size === 0) delete rooms[roomId];
    }
    // Tell remaining peers so they can close/remove that video tile
    socket.to(roomId).emit('peer-left', socket.id);
    console.log('client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Signaling server running at http://localhost:${PORT}`);
});
