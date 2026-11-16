# threejs-fps-02

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/gtumbal51/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/gtumbal51/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

**Lentera — Night Market Strike**: a round-based tactical FPS in three.js. 5v5, 12 rounds, first to 7 — the Embers attack a lantern-lit night market, the Nightwatch defend it. Plant or defuse the charge, earn money each round, spend it in the buy menu, and win gunfights where stopping to aim pays.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 in desktop Chrome. No build step, no network — three.js 0.187.0 is vendored under `game/vendor/three/`.

## How it plays

- **Complete game**: first-person view with pointer-lock mouse look and WASD movement, weapons that fire / reload / run dry, five bots per side that move, see and shoot back, rounds that end in a win or loss and restart, and a HUD with health, armour, cash, ammo, round timer and score.
- **Gunplay**: headshot hitboxes, recoil and spread that punish firing on the move (the HUD shows a live spread readout), acceleration, crouching, aim-walking, jumping and full map collision.
- **Tactics**: a charge to plant (hold E, 40 s fuse) and defuse (7 s, 3.6 s with a kit), money per round spent in a buy menu (5 weapons, gear, 4 grenades), and bots with roles and round plans that follow routes, hold positions and react to sight *and* sound.
- **Map**: Lentera Night Market — one invented place, three lanes, two sites (A west, B east), stalls, crates, a lantern plaza and painted signage everywhere, in a single night-indigo / lantern-amber palette.
- **Code**: one job per module, a fixed 60 Hz simulation apart from rendering, pooled effects, state in one place.

## Controls

WASD move · Mouse look · Click fire · R reload · 1/2 weapons · 3 grenade · G throw · E plant/defuse/pick up · B buy menu · Tab scoreboard · Ctrl/C crouch · Shift aim-walk · Space jump.

---

<sub>Entered on [make.fun](https://make.fun/?ref=gtumbal51&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
