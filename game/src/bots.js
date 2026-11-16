// Bot fighters: named teammates and opponents with roles. Each bot follows a route of
// waypoints, holds an anchor on defence, and fights with the same rules as the player:
// line of sight checked against the world, bursts with pauses, worse aim while moving,
// and hearing — a gunshot inside earshot turns a bot toward the sound and may pull it
// off its route to investigate. A bot is a body with a head and a torso, so headshots
// and body shots are different hits, exactly as for the player.
import * as THREE from 'three';
import { WEAPONS, CALLOUTS, calloutAt } from './config.js';

const RADIUS = 0.34;
const HEIGHT = 1.72;
const EYE = 1.55;
const WALK = 4.3;

export function createBots(scene, world) {
  const bots = [];
  const tmp = new THREE.Vector3();
  const probe = new THREE.Box3();

  function buildMesh(team, helmet) {
    const g = new THREE.Group();
    const teamMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(team === 'embers' ? 0xffb347 : 0x3ec6b8), roughness: 0.7 });
    const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x232c3d), roughness: 0.85 });
    const skinMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0xc9a06a), roughness: 0.7 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.68, 0.3), teamMat);
    torso.position.y = 1.08;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), helmet ? darkMat : skinMat);
    head.position.y = 1.58;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.72, 0.2), darkMat);
    legL.position.set(-0.13, 0.36, 0);
    const legR = legL.clone();
    legR.position.x = 0.13;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.62), darkMat);
    gun.position.set(0.16, 1.18, -0.28);
    g.add(torso, head, legL, legR, gun);
    g.traverse((m) => { if (m.isMesh) { m.castShadow = true; } });
    return { group: g, torso, head, gun };
  }

  function overlaps(x, y, z) {
    probe.min.set(x - RADIUS, y + 0.05, z - RADIUS);
    probe.max.set(x + RADIUS, y + HEIGHT - 0.05, z + RADIUS);
    for (const c of world.colliders) if (probe.intersectsBox(c)) return true;
    return false;
  }

  function addFighter(cfg) {
    const mesh = buildMesh(cfg.team, false);
    scene.add(mesh.group);
    const bot = {
      id: cfg.id,
      name: cfg.name,
      role: cfg.role,
      team: cfg.team,
      isPlayer: false,
      weapon: WEAPONS[cfg.weapon],
      pos: new THREE.Vector3(cfg.spawn[0], 0, cfg.spawn[1]),
      yaw: 0,
      hp: 100,
      armor: 0,
      helmet: false,
      alive: true,
      route: [],
      routeIdx: 0,
      anchor: null,
      mode: 'route',
      target: null,
      lastSeen: null,
      lastSeenT: -99,
      reactT: 0,
      burstLeft: 0,
      burstT: 0,
      pauseT: 0,
      strafeDir: 1,
      strafeT: 0,
      fall: 0,
      speed: cfg.role === 'AWPer' ? 3.8 : WALK,
      hearT: 0,
      investigate: null,
      firedAt: -99,
      firedRecently: false,
      mesh,
      stats: { k: 0, d: 0, a: 0, hs: 0, dmg: 0, cash: 0 },
    };
    mesh.torso.userData.bot = bot;
    mesh.torso.userData.part = 'torso';
    mesh.head.userData.bot = bot;
    mesh.head.userData.part = 'head';
    bots.push(bot);
    return bot;
  }

  function moveToward(bot, tx, tz, dt, speedMul = 1) {
    const dx = tx - bot.pos.x;
    const dz = tz - bot.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.15) return true;
    const sp = bot.speed * speedMul;
    const stepX = (dx / dist) * sp * dt;
    const stepZ = (dz / dist) * sp * dt;
    bot.yaw = Math.atan2(-dx, -dz);
    const nx = bot.pos.x + stepX;
    if (!overlaps(nx, 0, bot.pos.z)) bot.pos.x = nx;
    const nz = bot.pos.z + stepZ;
    if (!overlaps(bot.pos.x, 0, nz)) bot.pos.z = nz;
    return Math.hypot(tx - bot.pos.x, tz - bot.pos.z) < 0.3;
  }

  function stepBot(bot, dt, time, ctx) {
    const m = bot.mesh.group;
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / 0.4);
      m.rotation.x = -bot.fall * 1.5;
      m.position.y = -bot.fall * 0.1;
      return;
    }
    m.rotation.x = 0;
    m.position.y = 0;

    // Perception: scan enemies every frame is cheap at 10 fighters; LOS via callback.
    let seen = null;
    let seenDist = 1e9;
    for (const e of ctx.fighters) {
      if (!e.alive || e.team === bot.team) continue;
      const d = Math.hypot(e.pos.x - bot.pos.x, e.pos.z - bot.pos.z);
      if (d > 48) continue;
      tmp.set(e.pos.x, e.pos.y + 1.2, e.pos.z);
      if (ctx.los(bot.pos.x, EYE, bot.pos.z, tmp)) {
        // Facing check: bots notice what is in front, or anything close, or a shooter.
        const ang = Math.atan2(-(e.pos.x - bot.pos.x), -(e.pos.z - bot.pos.z));
        let diff = Math.abs(ang - bot.yaw);
        if (diff > Math.PI) diff = 2 * Math.PI - diff;
        if (diff < 1.9 || d < 6 || e.firedRecently) {
          if (d < seenDist) { seen = e; seenDist = d; }
        }
      }
    }
    if (seen) {
      if (!bot.target) bot.reactT = 0.35 + Math.random() * 0.35;
      bot.lastSeen = { x: seen.pos.x, z: seen.pos.z, y: seen.pos.y + 1.2, head: Math.random() < 0.22 };
      bot.lastSeenT = time;
      bot.target = seen;
    } else if (bot.target && time - bot.lastSeenT > 1.2) {
      bot.target = null;
    }

    // Hearing: a shot inside earshot pulls the bot toward the sound.
    for (const s of ctx.sounds) {
      const d = Math.hypot(s.x - bot.pos.x, s.z - bot.pos.z);
      if (d < s.r && time - s.t < 0.2) {
        bot.hearT = time;
        if (!bot.target && bot.mode !== 'hold' && bot.mode !== 'investigate' && Math.random() < 0.55) {
          bot.investigate = { x: s.x, z: s.z };
          bot.mode = 'investigate';
          if (ctx.radio) ctx.radio(`${bot.name}: Heard shots, ${CALLOUTS[calloutAt(s.x, s.z)]} — checking it`);
        }
        if (bot.mode === 'hold' && d < 14) {
          bot.yaw = Math.atan2(-(s.x - bot.pos.x), -(s.z - bot.pos.z));
        }
      }
    }

    // Combat: face the last seen spot, burst fire, strafe.
    if (bot.target && bot.lastSeen) {
      const ls = bot.lastSeen;
      bot.yaw = Math.atan2(-(ls.x - bot.pos.x), -(ls.z - bot.pos.z));
      bot.strafeT -= dt;
      if (bot.strafeT <= 0) {
        bot.strafeDir *= -1;
        bot.strafeT = 0.5 + Math.random() * 0.7;
      }
      const px = bot.pos.x + Math.cos(bot.yaw) * bot.strafeDir * bot.speed * 0.55 * dt;
      const pz = bot.pos.z - Math.sin(bot.yaw) * bot.strafeDir * bot.speed * 0.55 * dt;
      if (!overlaps(px, 0, bot.pos.z)) bot.pos.x = px;
      if (!overlaps(bot.pos.x, 0, pz)) bot.pos.z = pz;
      if (bot.reactT <= 0) {
        bot.pauseT -= dt;
        if (bot.pauseT <= 0) {
          if (bot.burstLeft <= 0) {
            bot.burstLeft = bot.weapon.id === 'sniper' ? 1 : bot.weapon.id === 'smg' ? 6 : bot.weapon.id === 'shotgun' ? 1 : 4;
            bot.burstT = 0;
          } else {
            bot.burstT -= dt;
            if (bot.burstT <= 0) {
              bot.burstT = 60 / bot.weapon.rpm;
              bot.burstLeft -= 1;
              const dNow = Math.hypot(ls.x - bot.pos.x, ls.z - bot.pos.z);
              const spread = 0.012 + dNow * 0.0009 + (bot.weapon.id === 'sniper' ? 0.002 : 0.008);
              ctx.shootBot(bot, ls, spread);
              if (bot.burstLeft <= 0) bot.pauseT = bot.weapon.id === 'sniper' ? 1.7 : 0.6 + Math.random() * 0.7;
            }
          }
        }
      } else {
        bot.reactT -= dt;
      }
    } else {
      // No target: follow the route, hold the anchor, or investigate a sound.
      if (bot.mode === 'investigate' && bot.investigate) {
        if (moveToward(bot, bot.investigate.x, bot.investigate.z, dt, 1.15)) {
          bot.investigate = null;
          bot.mode = bot.route.length ? 'route' : 'hold';
        }
      } else if (bot.mode === 'route' && bot.route.length) {
        const wp = bot.route[bot.routeIdx];
        if (wp && moveToward(bot, wp[0], wp[1], dt)) {
          bot.routeIdx += 1;
          if (bot.routeIdx >= bot.route.length) {
            bot.mode = bot.anchor ? 'hold' : 'route';
            bot.routeIdx = bot.route.length - 1;
          }
        }
      } else if (bot.mode === 'hold' && bot.anchor) {
        const dx = bot.anchor[0] - bot.pos.x;
        const dz = bot.anchor[1] - bot.pos.z;
        if (Math.hypot(dx, dz) > 0.4) moveToward(bot, bot.anchor[0], bot.anchor[1], dt, 0.8);
        else {
          // Idle scan: slow yaw sweep so a held angle still moves.
          bot.yaw += Math.sin(time * 0.5 + bot.id * 1.3) * dt * 0.35;
        }
      }
    }

    // Walk bob and mesh sync.
    const moving = bot.mode === 'route' || bot.mode === 'investigate';
    m.position.set(bot.pos.x, Math.sin(time * 9 + bot.id) * (moving ? 0.03 : 0), bot.pos.z);
    m.rotation.y = bot.yaw;
    m.rotation.x = 0;
  }

  return {
    bots,
    addFighter,
    hitMeshes() {
      const out = [];
      for (const b of bots) out.push(b.mesh.torso, b.mesh.head);
      return out;
    },
    step(dt, time, ctx) {
      for (const b of bots) stepBot(b, dt, time, ctx);
    },
    aliveCount(team) {
      return bots.filter((b) => b.alive && b.team === team).length;
    },
    resetFighter(bot, spawn, weaponId, armor, helmet) {
      bot.pos.set(spawn[0], 0, spawn[1]);
      bot.yaw = bot.team === 'embers' ? Math.PI : 0;
      bot.hp = 100;
      bot.armor = armor;
      bot.helmet = helmet;
      bot.alive = true;
      bot.route = [];
      bot.routeIdx = 0;
      bot.anchor = null;
      bot.mode = 'route';
      bot.target = null;
      bot.lastSeen = null;
      bot.burstLeft = 0;
      bot.pauseT = 0.5 + Math.random();
      bot.reactT = 0.35 + Math.random() * 0.35;
      bot.fall = 0;
      bot.investigate = null;
      if (weaponId) bot.weapon = WEAPONS[weaponId];
      bot.mesh.group.rotation.set(0, bot.yaw, 0);
      bot.mesh.group.position.set(bot.pos.x, 0, bot.pos.z);
      bot.mesh.head.material = new THREE.MeshStandardMaterial({ color: new THREE.Color(helmet ? 0x232c3d : 0xc9a06a), roughness: 0.7 });
    },
  };
}
