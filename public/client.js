// client.js
// Single shared room: everyone who opens this page and clicks "Join the
// call" lands in the same call. No room names, no setup screen fields —
// just capture media, join, and create a direct RTCPeerConnection to
// every other participant already there (mesh topology).

const ROOM_ID = 'main-room';

// STUN discovers your public IP/port — enough for most Wi-Fi to Wi-Fi
// connections. TURN is a relay server used when a direct route can't be
// found (this is the common case for cellular/mobile data, which sits
// behind carrier-grade NAT). Without TURN, calls involving a phone on
// cellular data will often show your own camera but never the other
// person's — the peer connection never actually completes.
//
// Get free TURN credentials in ~2 minutes at https://www.metered.ca/tools/openrelay/
// (or run your own with coturn: https://github.com/coturn/coturn) and
// paste them in below.
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:YOUR_TURN_HOST:3478',
      username: 'YOUR_TURN_USERNAME',
      credential: 'YOUR_TURN_CREDENTIAL'
    }
  ]
};

const QUOTES = [
  'Good conversations rarely wait for perfect conditions.',
  'Show up first, look good later.',
  'Every call starts with someone hitting join.',
  'Being on time is its own kind of kindness.',
  'The best meetings start with a real hello.',
  'Small talk is just the warm-up lap.',
  'Presence is the whole point.',
  'One click, and you are in the room.'
];

let localStream = null;
let myName = 'Guest ' + Math.floor(100 + Math.random() * 900);
let callStartTime = null;
const peers = {};       // peerId -> RTCPeerConnection
const peerNames = {};   // peerId -> display name

const joinScreen = document.getElementById('join-screen');
const callScreen = document.getElementById('call-screen');
const joinBtn = document.getElementById('join-btn');
const joinError = document.getElementById('join-error');
const leaveBtn = document.getElementById('leave-btn');
const micBtn = document.getElementById('toggle-mic-btn');
const camBtn = document.getElementById('toggle-cam-btn');
const videoGrid = document.getElementById('video-grid');
const tileTemplate = document.getElementById('video-tile-template');
const participantCount = document.getElementById('participant-count');
const callTimer = document.getElementById('call-timer');
const clockEl = document.getElementById('clock');
const weatherEl = document.getElementById('weather');
const quoteEl = document.getElementById('quote');

const socket = io();

joinBtn.addEventListener('click', joinCall);
leaveBtn.addEventListener('click', leaveCall);
micBtn.addEventListener('click', toggleMic);
camBtn.addEventListener('click', toggleCam);

// ---------- Join screen extras: clock, weather, quote ----------

quoteEl.textContent = '"' + QUOTES[Math.floor(Math.random() * QUOTES.length)] + '"';

function tickClock() {
  clockEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
tickClock();
setInterval(tickClock, 1000);

const WEATHER_CODES = {
  0: 'Clear sky', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
  80: 'Rain showers', 81: 'Rain showers', 82: 'Violent showers',
  95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm'
};

function loadWeather() {
  if (!navigator.geolocation) {
    weatherEl.textContent = 'Unavailable';
    return;
  }
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        const { latitude, longitude } = pos.coords;
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&temperature_unit=fahrenheit`;
        const res = await fetch(url);
        const data = await res.json();
        const temp = Math.round(data.current_weather.temperature);
        const desc = WEATHER_CODES[data.current_weather.weathercode] || 'Mixed';
        weatherEl.textContent = `${temp}°F, ${desc}`;
      } catch (err) {
        weatherEl.textContent = 'Unavailable';
      }
    },
    () => { weatherEl.textContent = 'Location off'; },
    { timeout: 6000 }
  );
}
loadWeather();

// ---------- Joining the call ----------

async function joinCall() {
  joinError.classList.add('hidden');
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (err) {
    joinError.textContent = 'Could not access camera/microphone: ' + err.message;
    joinError.classList.remove('hidden');
    return;
  }

  addVideoTile('local', localStream, myName, true);

  joinScreen.classList.add('hidden');
  callScreen.classList.remove('hidden');

  startTimer();
  updateParticipantCount();

  socket.emit('join-room', ROOM_ID, myName);
}

function leaveCall() {
  Object.keys(peers).forEach(removePeer);
  if (localStream) localStream.getTracks().forEach((t) => t.stop());
  socket.disconnect();
  window.location.reload();
}

function toggleMic() {
  const track = localStream.getAudioTracks()[0];
  track.enabled = !track.enabled;
  micBtn.classList.toggle('is-off', !track.enabled);
}

function toggleCam() {
  const track = localStream.getVideoTracks()[0];
  track.enabled = !track.enabled;
  camBtn.classList.toggle('is-off', !track.enabled);
  document.getElementById('tile-local').classList.toggle('cam-off', !track.enabled);
}

function startTimer() {
  callStartTime = Date.now();
  setInterval(() => {
    const secs = Math.floor((Date.now() - callStartTime) / 1000);
    const m = String(Math.floor(secs / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    callTimer.textContent = `${m}:${s}`;
  }, 1000);
}

function updateParticipantCount() {
  const n = Object.keys(peers).length + 1;
  participantCount.textContent = n === 1 ? '1 in call' : `${n} in call`;
}

// ---------- Signaling handlers ----------

socket.on('existing-peers', (peerList) => {
  peerList.forEach(({ id, name }) => {
    peerNames[id] = name;
    createPeerConnection(id, true);
  });
});

socket.on('peer-joined', ({ id, name }) => {
  peerNames[id] = name;
});

socket.on('offer', async ({ from, offer }) => {
  const pc = createPeerConnection(from, false);
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('answer', { to: from, answer });
});

socket.on('answer', async ({ from, answer }) => {
  const pc = peers[from];
  if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on('ice-candidate', async ({ from, candidate }) => {
  const pc = peers[from];
  if (pc && candidate) {
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); }
    catch (err) { console.warn('Failed to add ICE candidate', err); }
  }
});

socket.on('peer-left', (peerId) => {
  removePeer(peerId);
  updateParticipantCount();
});

// ---------- WebRTC plumbing ----------

function createPeerConnection(peerId, isInitiator) {
  if (peers[peerId]) return peers[peerId];

  const pc = new RTCPeerConnection(ICE_SERVERS);
  peers[peerId] = pc;

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { to: peerId, candidate: event.candidate });
    }
  };

  pc.ontrack = (event) => {
    const name = peerNames[peerId] || 'Guest';
    addVideoTile(peerId, event.streams[0], name, false);
    updateParticipantCount();
  };

  pc.onconnectionstatechange = () => {
    const dot = document.querySelector(`#tile-${peerId} .status-dot`);
    if (dot) {
      dot.classList.remove('connecting', 'connected');
      dot.classList.add(pc.connectionState === 'connected' ? 'connected' : 'connecting');
    }
    if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
      removePeer(peerId);
      updateParticipantCount();
    }
  };

  if (isInitiator) {
    pc.onnegotiationneeded = async () => {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('offer', { to: peerId, offer });
    };
  }

  return pc;
}

function removePeer(peerId) {
  if (peers[peerId]) {
    peers[peerId].close();
    delete peers[peerId];
  }
  const tile = document.getElementById('tile-' + peerId);
  if (tile) tile.remove();
}

// ---------- Video grid UI ----------

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function addVideoTile(id, stream, label, isLocal) {
  if (document.getElementById('tile-' + id)) return;
  const node = tileTemplate.content.cloneNode(true);
  const tile = node.querySelector('.video-tile');
  const video = node.querySelector('video');
  tile.id = 'tile-' + id;
  if (isLocal) tile.classList.add('is-local');
  video.srcObject = stream;
  if (isLocal) video.muted = true;
  node.querySelector('.label').textContent = isLocal ? `${label} (you)` : label;
  node.querySelector('.avatar-initials').textContent = initials(label);
  const dot = node.querySelector('.status-dot');
  if (isLocal) dot.remove();
  videoGrid.appendChild(node);
}
