# Frontline Relay

`Frontline Relay` is a browser RTS slice built with React for the HUD and Three.js for the battlefield renderer. It ships with unit selection, move and attack orders, relay capture, enemy waves, base production, combat VFX, a tactical minimap, and a responsive command overlay.

## Run

```bash
npm install
npm run dev
```

Open the local Vite URL in a desktop browser.

## Controls

- `WASD` or move the cursor to the screen edge: pan the camera
- Mouse wheel: zoom
- `Q` / `E`: rotate camera
- Left drag: box-select units
- Right click: move or attack
- `Space`: center on your current force or HQ

## Build

```bash
npm run build
```

## Structure

- [src/game/engine.ts](/Users/patryktargosinski/rts/src/game/engine.ts): simulation loop, rendering, camera, input, and AI
- [src/components/Hud.tsx](/Users/patryktargosinski/rts/src/components/Hud.tsx): React HUD, minimap, production, and event feed
- [src/game/terrain.ts](/Users/patryktargosinski/rts/src/game/terrain.ts): procedural terrain generation and coloring
