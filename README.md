# Simple video call app (1:1 + group)

Plain HTML/CSS/JS frontend + a small Node.js signaling server. No frameworks,
no build step. Uses WebRTC for the actual audio/video, mesh topology for group calls.

## How the pieces fit together

- `server.js` — Express + Socket.io. Only relays text messages (who joined,
  offers/answers/ICE candidates). It never sees or touches video/audio.
- `public/index.html` / `style.css` — the join screen and video grid.
- `public/client.js` — captures your camera/mic and creates one
  `RTCPeerConnection` per other participant. That connection carries the
  actual media, directly between browsers.

There's only one room (`main-room`, set in `client.js`) and one button —
whoever opens the page and clicks "Join the call" lands in the same
call as everyone else currently on it. The join screen shows a live
clock, local weather (via the free Open-Meteo API, using your browser's
geolocation — no API key needed), and a rotating one-line motivational
note. Once in the call, a status dot on each tile shows amber
(connecting) or green (connected), and turning your camera off shows
your initials instead of a frozen frame.

If you'd rather support multiple separate rooms again later, change
`ROOM_ID` in `public/client.js` back into a value read from user input —
the server already handles arbitrary room IDs.

## Step 1 — Install prerequisites

You need [Node.js](https://nodejs.org) (v18+) installed.

## Step 2 — Install dependencies

```bash
cd videocall
npm install
```

## Step 3 — Run the server

```bash
npm start
```

You'll see: `Signaling server running at http://localhost:3000`

## Step 4 — Test a 1:1 call

1. Open `http://localhost:3000` in one browser tab, type a room name
   (e.g. `test-room`), click "Join call".
2. Open the same URL in a **second tab or a different browser** (or
   another device on your network using your computer's local IP, e.g.
   `http://192.168.1.20:3000`), enter the **same room name**, join.
3. Allow camera/mic permissions in both. You should see both video feeds.

## Step 5 — Test a group call

Open a third, fourth, fifth tab/device with the same room name. Each new
participant automatically forms a direct connection to everyone already
in the room — no code changes needed. This mesh approach works well for
small groups (roughly up to 4–6 people); past that, each browser is
uploading too many simultaneous video streams and quality will suffer.

## Deploying so others can join over the internet

`localhost` only works on your own machine. To let others join:

- Deploy `server.js` to any Node host (Render, Railway, Fly.io, a VPS, etc).
- **HTTPS is required** — browsers block camera/mic access on plain HTTP
  for any host other than `localhost`. Most hosting platforms give you
  HTTPS automatically.
- If some participants are behind strict corporate NATs/firewalls, the
  public STUN server used here (`stun.l.google.com`) won't be enough —
  you'd add a TURN server (e.g. via [coturn](https://github.com/coturn/coturn)
  or a hosted provider like Twilio/Xirsys) and list it alongside STUN in
  `ICE_SERVERS` in `client.js`.

## Known limitations of this "simplest" version

- **No authentication** — anyone who knows/guesses a room name can join it.
  For real use, generate random/unguessable room IDs or add a login step.
- **Mesh doesn't scale past ~6 people** — for larger group calls you'd
  introduce an SFU (Selective Forwarding Unit) like
  [mediasoup](https://mediasoup.org) or [LiveKit](https://livekit.io), so
  each client uploads once and the server fans it out. That's a bigger
  architectural change, worth doing only once you outgrow mesh.
- **No screen share, chat, or recording** — straightforward to add:
  screen share is just another `getDisplayMedia()` track added to each
  peer connection.
- **No reconnect-on-network-change logic** — if someone's network drops
  mid-call, they currently need to rejoin.

## File structure

```
videocall/
├── package.json
├── server.js
└── public/
    ├── index.html
    ├── style.css
    └── client.js
```
