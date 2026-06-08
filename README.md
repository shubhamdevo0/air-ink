# AR Whiteboard

**Draw in the air with your bare hands.** AR Whiteboard uses your webcam and real-time AI hand tracking to let you paint neon strokes mid-air — no stylus, no touch screen, just your fingers.

![AR Whiteboard](https://img.shields.io/badge/Built%20with-React%20%2B%20MediaPipe-blue?style=flat-square) ![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

---

## Demo

> Open the app, allow camera access, and point your index finger at the screen to start drawing.

| Gesture | Action |
|---|---|
| ☝️ Index finger up | Draw |
| 🤏 Pinch (thumb + index) | Grab & move a stroke group |
| 🖐️ Open palm | Erase a large area |
| ✌️ Peace sign | Erase a small area |

---

## Features

- **Real-time hand tracking** via MediaPipe Hands (runs entirely in the browser — no server, no data sent anywhere)
- **Neon glow rendering** — 4-layer canvas glow engine with outer halo, bloom ring, bright core, and hot white highlight
- **8 neon colors** — Red, Orange, Yellow, Green, Blue, Magenta, Violet, White
- **4 brush sizes** — XS · S · M · L
- **Gesture-based erasing** — open palm wipes a large radius; peace sign erases nearby strokes
- **Pinch to move** — grab any stroke group and reposition it
- **Save Snapshot** — composites your webcam frame + drawings and downloads as a PNG, with shutter flash + confetti burst animation
- **Stroke stabilizer** — 6-frame weighted average smooths jitter out of fast hand movement
- **Group-aware canvas** — strokes drawn within 1.5 s are linked into a group for batch movement
- **Toolbar** — floating frosted-glass panel: tools, colors, sizes, clear all

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 18 + TypeScript |
| Build | Vite 7 |
| Styling | Tailwind CSS v4 |
| Hand tracking | [MediaPipe Hands](https://google.github.io/mediapipe/solutions/hands) (CDN, WASM) |
| Rendering | HTML5 Canvas 2D API |
| Monorepo | pnpm workspaces |

---

## Getting Started

### Prerequisites

- **Node.js 20+** and **pnpm 9+**
- A webcam (built-in or USB)
- Chrome or Edge (recommended for best WebGL + WASM performance)

### Install & run

```bash
# Clone the repo
git clone https://github.com/shubhamdevo0/ar-whiteboard.git
cd ar-whiteboard

# Install dependencies
pnpm install

# Start the dev server
pnpm --filter @workspace/ar-whiteboard run dev
```

Then open **http://localhost:19089** in your browser and allow camera access.

### Build for production

```bash
pnpm --filter @workspace/ar-whiteboard run build
```

Output lands in `artifacts/ar-whiteboard/dist/`.

---

## Project Structure

```
ar-whiteboard/
├── artifacts/
│   └── ar-whiteboard/          # Main web app
│       ├── src/
│       │   ├── pages/
│       │   │   └── Whiteboard.tsx   # Hand tracking loop + canvas engine
│       │   ├── components/
│       │   │   └── Toolbar.tsx      # Color / size / tool picker
│       │   └── types/
│       │       └── whiteboard.ts    # Shared types (Stroke, Tool, Point)
│       ├── index.html
│       └── vite.config.ts
└── pnpm-workspace.yaml
```

---

## How it works

1. **Camera feed** is streamed into a hidden `<video>` element and rendered mirrored via CSS.
2. Every ~33 ms the current video frame is sent to **MediaPipe Hands**, which returns 21 3-D landmarks per hand.
3. Landmark geometry is analysed to classify one of five gestures: *draw*, *erase-small*, *erase-large*, *move*, *idle*.
4. Drawing coordinates are **mirror-flipped** in JS (`x = 1 - landmark.x`) so they align with the mirrored video.
5. A 6-frame **stabilizer buffer** applies weighted-average smoothing before points are committed to a stroke.
6. Strokes are rendered onto a transparent `<canvas>` overlay using a **4-pass neon glow pipeline** (outer halo → mid bloom → core line → white highlight) with `globalCompositeOperation = "lighter"` for additive colour blending.
7. On **Save**, an offscreen canvas composites the mirrored video frame + drawing layer and triggers a PNG download.

---

## Gesture Detection Details

| Gesture | Detection logic |
|---|---|
| Draw | Index finger tip-to-MCP ratio > 1.5 AND tip-to-wrist reach > 1.45× MCP reach |
| Erase (small) | Index + middle extended, ring + pinky closed (peace sign) — debounced 45 frames |
| Erase (large) | All 5 fingers extended (open palm) — debounced 45 frames |
| Move / grab | Thumb-to-index tip distance < 22% of hand size, sustained 4 frames |

---

## Browser Compatibility

| Browser | Support |
|---|---|
| Chrome 112+ | ✅ Full |
| Edge 112+ | ✅ Full |
| Firefox | ⚠️ WebGL WASM may be slower |
| Safari | ⚠️ MediaPipe WASM support varies |

---

## License

MIT — do whatever you like with it.

---

## Acknowledgements

- [MediaPipe Hands](https://google.github.io/mediapipe/solutions/hands) by Google
- Built with React + Vite
