// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's
// rate. This module owns the single state object (fighters, charge, grenades, sounds),
// resolves every shot against real hitboxes, runs the plant/defuse and buy flows, and
// stages the four deterministic screenshot setups (?shot=combat|buy|plant|score).
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { MATCH, ECONOMY, WEAPONS, GEAR, GRENADES, TEAMS, ROSTER, PLANS, CALLOUTS, calloutAt } from './config.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapons } from './weapons.js';
import { createBots } from './bots.js';
import { createRounds } from './rounds.js';
import { createFx } from './fx.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.night);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.night), 22, 60);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const fx = createFx(scene);
const audio = createAudio();
const rounds = createRounds();
const bots = createBots(scene, world);
const player = createPlayer(world.colliders);
const weapons = createWeapons(camera);
const input = createInput(renderer.domElement, onLockChange);
const hud = createHud({
  onBuy: (kind, id) => buyItem(kind, id),
  onCloseBuy: () => closeBuy(),
});
hud.setMap(world);

// ---- the single state object -------------------------------------------------
const body = player.state;
const state = {
  time: 0,
  started: false,
  buyOpen: false,
  boardOpen: false,
  charge: { mode: 'none', carrier: null, x: 0, z: 0, site: null, plantT: 0, defuseT: 0, defuser: null },
  grenades: [],
  sounds: [],
  plantHold: 0,
  defuseHold: 0,
  beepT: 0,
  spectate: null,
  minimapT: 0,
};

const playerFighter = {
  id: 0, name: 'Sepz', team: 'embers', role: 'Entry', isPlayer: true,
  pos: body.position, yaw: 0, hp: 100, armor: 0, helmet: false, alive: true,
  cash: MATCH.START_CASH, firedAt: -99, firedRecently: false,
  stats: { k: 0, d: 0, a: 0, hs: 0, dmg: 0 },
  lastDamager: null, lastDamageT: -99,
};
const fighters = [playerFighter];
const playerHit = {};
{
  const mk = (w, h, d, y, part) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
    m.position.y = y;
    m.userData.fighter = playerFighter;
    m.userData.part = part;
    scene.add(m);
    playerHit[part] = m;
    return m;
  };
  mk(0.56, 0.72, 0.32, 1.08, 'torso');
  mk(0.3, 0.3, 0.3, 1.58, 'head');
}
const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const shootList = world.shootables.concat(bots.hitMeshes(), playerHit.torso, playerHit.head);
const muzzle = new THREE.Vector3();
const dirV = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

function allFighters() {
  return fighters;
}

function aliveCounts() {
  let e = 0;
  let n = 0;
  for (const f of fighters) {
    if (!f.alive) continue;
    if (f.team === 'embers') e += 1;
    else n += 1;
  }
  return { embers: e, night: n };
}

function teamOf(f) {
  return TEAMS[f.team];
}

function siteAt(x, z) {
  for (const [name, s] of Object.entries(world.sites)) {
    if (Math.hypot(x - s.x, z - s.z) <= s.r) return name;
  }
  return null;
}

// ---- charge mesh -------------------------------------------------------------
const chargeMesh = new THREE.Group();
{
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.24), new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.lantern), emissive: new THREE.Color(PALETTE.lantern), emissiveIntensity: 0.7, roughness: 0.5 }));
  box.position.y = 0.12;
  const light = new THREE.PointLight(new THREE.Color(PALETTE.coral), 0, 4);
  light.position.y = 0.4;
  chargeMesh.add(box, light);
  chargeMesh.visible = false;
  chargeMesh.userData.light = light;
  scene.add(chargeMesh);
}
const chargeBeep = { t: 0 };

// ---- grenade mesh pool -------------------------------------------------------
const nadeMeshes = [];
for (let i = 0; i < 6; i += 1) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.coral), roughness: 0.5 }));
  m.visible = false;
  scene.add(m);
  nadeMeshes.push(m);
}

// ---- roster ------------------------------------------------------------------
function buildRoster() {
  fighters.length = 1;
  bots.bots.length = 0;
  let id = 1;
  for (const r of ROSTER.embers) {
    const b = bots.addFighter({ id: id++, name: r.name, role: r.role, team: 'embers', weapon: r.weapon, spawn: [0, 15] });
    fighters.push(b);
  }
  for (const r of ROSTER.night) {
    const b = bots.addFighter({ id: id++, name: r.name, role: r.role, team: 'night', weapon: r.weapon, spawn: [0, -15] });
    fighters.push(b);
  }
}
buildRoster();
// Bot hit meshes join the shoot list once the roster exists (they are empty before).
shootList.push(...bots.hitMeshes());

function playerIsAttacker() {
  return rounds.attackerTeam() === 'embers';
}

// ---- economy / buy -----------------------------------------------------------
const owned = { weapons: ['pistol'], gear: [], grenades: {} };

function ownedSnapshot() {
  return { weapons: owned.weapons.slice(), gear: owned.gear.slice(), grenades: { ...owned.grenades } };
}

function buyItem(kind, id) {
  if (rounds.state.phase !== 'buy' || !playerFighter.alive) return;
  const table = kind === 'weapon' ? WEAPONS : kind === 'gear' ? GEAR : GRENADES;
  const item = table[id];
  if (!item) return;
  if (kind === 'gear' && id === 'kit' && playerIsAttacker()) {
    // Defuse kits are a defender purchase; attackers cannot use one.
    hud.radio('Defuse kit is for defenders — you are attacking.');
    return;
  }
  if (kind === 'weapon' && owned.weapons.includes(id)) return;
  if (kind === 'gear' && owned.gear.includes(id)) return;
  if (playerFighter.cash < item.price) return;
  playerFighter.cash -= item.price;
  if (kind === 'weapon') {
    owned.weapons.push(id);
    weapons.give(id);
  } else if (kind === 'gear') {
    owned.gear.push(id);
    if (id === 'vest') playerFighter.armor = 50;
    if (id === 'vesthelm') { playerFighter.armor = 100; playerFighter.helmet = true; }
    if (id === 'kit') playerFighter.kit = true;
  } else {
    owned.grenades[id] = (owned.grenades[id] ?? 0) + 1;
    weapons.giveGrenade(id);
  }
  audio.buy();
  hud.refreshBuy(playerFighter.cash, ownedSnapshot());
  hud.setCash(playerFighter.cash);
  hud.setSlots(weapons.inv.slot, weapons.inv.grenades);
}

function openBuy() {
  if (rounds.state.phase !== 'buy') return;
  state.buyOpen = true;
  hud.showBuy(playerFighter.cash, ownedSnapshot());
  input.releaseLock();
}

function closeBuy() {
  if (!state.buyOpen) return;
  state.buyOpen = false;
  hud.hideBuy();
  if (state.started && playerFighter.alive && !shot) input.requestLock();
}

// ---- damage ------------------------------------------------------------------
function applyDamage(target, def, part, dist, attacker) {
  if (!target.alive) return;
  let dmg = def.damage * (part === 'head' ? def.headMult : 1);
  if (dist > def.range) dmg *= def.falloff;
  if (target.helmet && part === 'head') dmg *= 0.6;
  if (target.armor > 0) {
    const absorbed = dmg * 0.5;
    target.armor = Math.max(0, target.armor - absorbed);
    dmg *= 0.55;
  }
  target.hp -= dmg;
  target.lastDamager = attacker;
  target.lastDamageT = state.time;
  if (attacker) {
    attacker.stats.dmg += Math.round(dmg);
    if (part === 'head') attacker.stats.hs += 1;
  }
  if (target.isPlayer) {
    hud.damageFlash();
    audio.hurt();
  } else if (attacker?.isPlayer) {
    hud.hitMarker(false);
    audio.hit(part === 'head');
  }
  if (target.hp <= 0) killFighter(target, attacker, part, def);
}

function killFighter(target, attacker, part, def) {
  target.hp = 0;
  target.alive = false;
  target.stats.d += 1;
  if (attacker && attacker !== target) {
    attacker.stats.k += 1;
    attacker.cash += ECONOMY.KILL;
    if (target.lastDamager && target.lastDamager !== attacker && state.time - target.lastDamageT < 6) {
      target.lastDamager.stats.a += 1;
    }
    hud.killFeed(attacker, target, part === 'head', def?.name ?? 'charge');
    hud.radio(`${attacker.name} dropped ${target.name} at ${CALLOUTS[calloutAt(target.pos.x, target.pos.z)]}`);
  }
  if (target.isPlayer) {
    hud.banner('YOU ARE DOWN', 'Your team fights on — spectating.', 3000);
    state.spectate = fighters.find((f) => f.alive && f.team === 'embers' && !f.isPlayer) ?? null;
  }
  if (state.charge.carrier === target) {
    state.charge.mode = 'dropped';
    state.charge.carrier = null;
    state.charge.x = target.pos.x;
    state.charge.z = target.pos.z;
    chargeMesh.position.set(target.pos.x, 0, target.pos.z);
    chargeMesh.visible = true;
    hud.radio(`Charge dropped at ${CALLOUTS[calloutAt(target.pos.x, target.pos.z)]}`);
  }
  if (target.isPlayer) input.releaseLock();
}

// ---- shooting ----------------------------------------------------------------
function losClear(x1, y1, z1, to) {
  tmpV.set(to.x - x1, to.y - y1, to.z - z1);
  const dist = tmpV.length();
  if (dist < 0.01) return true;
  raycaster.set(tmpV2.set(x1, y1, z1), tmpV.normalize());
  raycaster.far = dist;
  const hit = raycaster.intersectObjects(world.shootables, false)[0];
  if (hit) return false;
  return !fx.blockedBySmoke(tmpV2, to);
}

function fireRay(origin, direction, def, attacker, pellets) {
  let anyHit = false;
  for (let p = 0; p < pellets; p += 1) {
    dirV.copy(direction);
    if (pellets > 1 || p > 0) {
      dirV.x += (random() * 2 - 1) * def.spreadStill * 6;
      dirV.y += (random() * 2 - 1) * def.spreadStill * 6;
      dirV.z += (random() * 2 - 1) * def.spreadStill * 6;
    }
    dirV.normalize();
    raycaster.set(origin, dirV);
    raycaster.far = 90;
    const hit = raycaster.intersectObjects(shootList, false)[0];
    const end = hit ? hit.point : tmpV.copy(origin).addScaledVector(dirV, 70);
    fx.tracer(muzzle, end, def.tracer);
    if (!hit) continue;
    const fighter = hit.object.userData.bot ?? hit.object.userData.fighter;
    if (fighter) {
      if (fighter.team === attacker.team) continue;
      anyHit = true;
      applyDamage(fighter, def, hit.object.userData.part ?? 'torso', hit.distance, attacker);
      fx.spark(hit.point);
    } else {
      fx.spark(hit.point, 0x8b98a8);
    }
  }
  return anyHit;
}

function playerShoot() {
  const def = weapons.current();
  if (!def) return;
  const speed = player.groundSpeed();
  const aiming = input.state.keys.has('ShiftLeft') || input.state.keys.has('ShiftRight');
  const spread = weapons.spread(speed, body.crouching, aiming);
  if (!weapons.takeRound()) {
    audio.dryClick();
    return;
  }
  camera.getWorldDirection(dirV);
  dirV.x += (random() * 2 - 1) * spread;
  dirV.y += (random() * 2 - 1) * spread;
  dirV.z += (random() * 2 - 1) * spread;
  dirV.normalize();
  muzzle.copy(camera.position);
  camera.localToWorld(tmpV.set(0.24, -0.19, -0.95));
  muzzle.copy(tmpV);
  const origin = camera.position;
  fireRay(origin, dirV, def.def, playerFighter, def.def.pellets ?? 1);
  weapons.pullTrigger();
  player.recoil(0.008 + random() * 0.005, (random() * 2 - 1) * 0.004);
  playerFighter.firedAt = state.time;
  playerFighter.firedRecently = true;
  state.sounds.push({ x: body.position.x, z: body.position.z, r: 26, t: state.time });
  audio.shot(def.def.id, 0);
}

function botShoot(bot, lastSeen, spread) {
  const eye = tmpV.set(bot.pos.x, bot.pos.y + 1.55, bot.pos.z);
  const target = tmpV2.set(lastSeen.x, lastSeen.y, lastSeen.z);
  dirV.subVectors(target, eye).normalize();
  dirV.x += (random() * 2 - 1) * spread;
  dirV.y += (random() * 2 - 1) * spread;
  dirV.z += (random() * 2 - 1) * spread;
  dirV.normalize();
  muzzle.copy(eye).addScaledVector(dirV, 0.6);
  const dist = Math.hypot(target.x - eye.x, target.z - eye.z);
  fireRay(eye, dirV, bot.weapon, bot, bot.weapon.pellets ?? 1);
  bot.firedAt = state.time;
  bot.firedRecently = true;
  state.sounds.push({ x: bot.pos.x, z: bot.pos.z, r: 26, t: state.time });
  audio.shot(bot.weapon.id, dist);
}

// ---- grenades ----------------------------------------------------------------
function throwGrenade() {
  const type = weapons.selectedGrenade();
  if (!type || !weapons.takeGrenade(type)) return;
  const def = GRENADES[type];
  camera.getWorldDirection(dirV);
  const mesh = nadeMeshes.find((m) => !m.visible) ?? nadeMeshes[0];
  mesh.visible = true;
  mesh.position.copy(camera.position);
  state.grenades.push({
    type, def, mesh,
    pos: camera.position.clone(),
    vel: dirV.clone().multiplyScalar(15).add(new THREE.Vector3(0, 3.5, 0)),
    fuse: def.fuse, owner: playerFighter,
  });
  audio.grenadePop();
  hud.setSlots(weapons.inv.slot, weapons.inv.grenades);
}

function grenadePop(g) {
  g.mesh.visible = false;
  const p = g.pos;
  if (g.type === 'frag') {
    audio.explosion();
    fx.spark(p, 0xff6b35);
    for (const f of fighters) {
      if (!f.alive) continue;
      const d = Math.hypot(f.pos.x - p.x, f.pos.z - p.z);
      if (d < g.def.radius) {
        const fall = 1 - (d / g.def.radius) * 0.7;
        const dmg = g.def.damage * fall;
        f.hp -= dmg;
        if (f.isPlayer) { hud.damageFlash(); audio.hurt(); }
        if (f.hp <= 0) killFighter(f, g.owner, 'torso', { name: g.def.name });
      }
    }
  } else if (g.type === 'smoke') {
    fx.smoke(p, g.def.radius, g.def.duration);
    hud.radio('Smoke out — sightline blocked');
  } else if (g.type === 'flash') {
    const toFlash = tmpV.subVectors(p, camera.position);
    const facing = camera.getWorldDirection(tmpV2).dot(toFlash.normalize()) > 0.2;
    const dPlayer = camera.position.distanceTo(p);
    if (facing && dPlayer < g.def.radius && losClear(camera.position.x, camera.position.y, camera.position.z, p)) {
      hud.flashBomb();
    }
    for (const b of bots.bots) {
      if (!b.alive) continue;
      const d = Math.hypot(b.pos.x - p.x, b.pos.z - p.z);
      if (d > g.def.radius) continue;
      const ang = Math.atan2(-(p.x - b.pos.x), -(p.z - b.pos.z));
      let diff = Math.abs(ang - b.yaw);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff < 1.9) {
        b.target = null;
        b.pauseT = 2.2;
        b.reactT = 1.2;
      }
    }
  } else if (g.type === 'fire') {
    fx.fire(p, g.def.radius, g.def.duration);
    hud.radio('Fire on the lane — nobody walks through that');
  }
}

function stepGrenades(dt) {
  for (let i = state.grenades.length - 1; i >= 0; i -= 1) {
    const g = state.grenades[i];
    g.fuse -= dt;
    g.vel.y -= 14 * dt;
    const nx = g.pos.x + g.vel.x * dt;
    const ny = g.pos.y + g.vel.y * dt;
    const nz = g.pos.z + g.vel.z * dt;
    let hitWall = false;
    for (const c of world.colliders) {
      if (nx > c.min.x && nx < c.max.x && ny > c.min.y && ny < c.max.y && nz > c.min.z && nz < c.max.z) { hitWall = true; break; }
    }
    if (hitWall) {
      g.vel.multiplyScalar(-0.35);
      g.vel.y = Math.abs(g.vel.y) * 0.3;
    } else {
      g.pos.set(nx, ny, nz);
    }
    if (g.pos.y < 0.1) {
      g.pos.y = 0.1;
      g.vel.y = Math.abs(g.vel.y) * 0.35;
      g.vel.x *= 0.7;
      g.vel.z *= 0.7;
    }
    g.mesh.position.copy(g.pos);
    if (g.fuse <= 0) {
      grenadePop(g);
      state.grenades.splice(i, 1);
    }
  }
  // Fire zones burn anyone standing in them.
  for (const c of fx.clouds) {
    if (c.kind !== 'fire' || c.life <= 0) continue;
    for (const f of fighters) {
      if (!f.alive) continue;
      if (Math.hypot(f.pos.x - c.x, f.pos.z - c.z) < c.r) {
        f.hp -= 35 * dt;
        if (f.isPlayer) hud.damageFlash();
        if (f.hp <= 0) killFighter(f, null, 'torso', { name: 'Bara Fire' });
      }
    }
  }
}

// ---- round flow --------------------------------------------------------------
function resetFighterPositions() {
  const atk = rounds.attackerTeam();
  const atkSpawns = world.spawns.attack;
  const defSpawns = world.spawns.defend;
  let ai = 0;
  let di = 0;
  for (const f of fighters) {
    const spawn = f.team === atk ? atkSpawns[ai++ % atkSpawns.length] : defSpawns[di++ % defSpawns.length];
    const faceYaw = f.team === atk ? 0 : Math.PI;
    if (f.isPlayer) {
      player.teleport(spawn[0], spawn[1], faceYaw);
      f.hp = 100;
      f.alive = true;
      f.armor = owned.gear.includes('vesthelm') ? 100 : owned.gear.includes('vest') ? 50 : 0;
      f.helmet = owned.gear.includes('vesthelm');
      f.kit = owned.gear.includes('kit');
      state.spectate = null;
    } else {
      const armor = rounds.state.round >= 2 ? 50 : 0;
      bots.resetFighter(f, spawn, null, armor, rounds.state.round >= 3);
      f.yaw = faceYaw;
      f.mesh.group.rotation.y = faceYaw;
    }
  }
}

function assignPlans() {
  const atk = rounds.attackerTeam();
  const site = rounds.state.targetSite;
  const routeKey = site === 'A' ? (Math.random() < 0.5 ? 'A_long' : 'A_mid') : (Math.random() < 0.5 ? 'B_short' : 'B_mid');
  const altKey = site === 'A' ? 'A_mid' : 'B_mid';
  for (const b of bots.bots) {
    if (b.team === atk) {
      b.route = (b.role === 'Lurk' ? world.routes[altKey] : world.routes[routeKey]).map((w) => [w[0], w[1]]);
      b.routeIdx = 0;
      b.mode = 'route';
      b.anchor = null;
    } else {
      const anchors = world.anchors[site].concat(world.anchors.mid);
      const a = anchors[b.id % anchors.length];
      b.anchor = [a[0], a[1]];
      b.route = [[b.pos.x, b.pos.z], [a[0], a[1]]];
      b.routeIdx = 0;
      b.mode = 'route';
    }
  }
  // The charge rides with the player on attack rounds, else with Rani.
  state.charge.mode = 'carried';
  state.charge.site = null;
  state.charge.plantT = 0;
  state.charge.defuseT = 0;
  state.charge.defuser = null;
  state.charge.carrier = playerIsAttacker() ? playerFighter : fighters.find((f) => f.name === 'Rani');
  chargeMesh.visible = false;
}

function handleRoundEvent(ev) {
  if (ev.type === 'roundStart') {
    resetFighterPositions();
    assignPlans();
    weapons.refillAmmo();
    state.plantHold = 0;
    state.defuseHold = 0;
    hud.banner(`ROUND ${ev.round} — ${rounds.state.plan.name}`, `${rounds.state.plan.desc} · You: ${playerIsAttacker() ? 'ENTRY, carry the charge' : 'DEFEND the sites'}`, 3200);
    hud.radio(`Plan: ${rounds.state.plan.name} — ${playerIsAttacker() ? 'you carry the charge' : 'hold the sites'}`);
    if (playerFighter.alive) openBuy();
  } else if (ev.type === 'liveStart') {
    closeBuy();
    hud.banner('GO — ROUND LIVE', playerIsAttacker() ? 'Plant the charge at A or B' : 'Hold the sites', 2000);
    audio.click();
  } else if (ev.type === 'planted') {
    state.charge.mode = 'planted';
    state.charge.site = ev.site;
    chargeMesh.position.set(state.charge.x, 0, state.charge.z);
    chargeMesh.visible = true;
    hud.banner('CHARGE PLANTED', `Detonation in ${MATCH.FUSE_SECONDS} s — ${playerIsAttacker() ? 'defend it' : 'defuse it'}`, 3200);
    audio.plantBeep();
    // Defenders rush the site; attackers fall back to guard it.
    const site = world.sites[ev.site];
    for (const b of bots.bots) {
      if (!b.alive) continue;
      if (b.team === rounds.defenderTeam()) {
        b.route = [[b.pos.x, b.pos.z], [site.x, site.z]];
        b.routeIdx = 0;
        b.mode = 'route';
        b.anchor = [site.x, site.z];
      } else {
        b.anchor = [site.x + (Math.random() * 4 - 2), site.z + (Math.random() * 4 - 2)];
        b.mode = 'hold';
      }
    }
  } else if (ev.type === 'detonated') {
    audio.explosion();
    fx.spark(new THREE.Vector3(state.charge.x, 1, state.charge.z), 0xff6b35);
    chargeMesh.visible = false;
  } else if (ev.type === 'roundEnd') {
    const won = ev.winner === playerFighter.team;
    for (const f of fighters) {
      f.cash += rounds.economyFor(f.team, f.team === ev.winner);
      f.stats.cash = f.cash;
    }
    hud.banner(won ? 'ROUND WON' : 'ROUND LOST', ev.reason, 3200);
    if (won) audio.roundWin();
    else audio.roundLose();
    hud.setCash(playerFighter.cash);
    closeBuy();
    if (input.state.locked) input.releaseLock();
  } else if (ev.type === 'matchEnd') {
    state.charge.mode = 'gone';
    chargeMesh.visible = false;
    hud.showScoreboard(scoreRows(), ev.winner === 'embers' ? 'EMBERS WIN THE MARKET' : 'NIGHTWATCH HOLDS THE MARKET');
    hud.showOverlay('end', { winner: ev.winner, embers: rounds.state.score.embers, night: rounds.state.score.night });
    if (input.state.locked) input.releaseLock();
  }
}

function scoreRows() {
  return fighters
    .slice()
    .sort((a, b) => b.stats.k - a.stats.k)
    .map((f) => ({ name: f.name, team: TEAMS[f.team].name, k: f.stats.k, a: f.stats.a, d: f.stats.d, hs: f.stats.hs, dmg: f.stats.dmg, cash: f.cash, isPlayer: f.isPlayer }));
}

function startMatch() {
  state.started = true;
  for (const f of fighters) {
    f.cash = MATCH.START_CASH;
    f.stats = { k: 0, d: 0, a: 0, hs: 0, dmg: 0 };
  }
  owned.weapons = ['pistol'];
  owned.gear = [];
  owned.grenades = {};
  weapons.reset();
  weapons.give('pistol');
  playerFighter.armor = 0;
  playerFighter.helmet = false;
  playerFighter.kit = false;
  rounds.beginMatch();
  handleRoundEvent({ type: 'roundStart', round: 1 });
}

function restartMatch() {
  hud.hideScoreboard();
  hud.hideOverlay();
  startMatch();
}

// ---- pointer lock / overlay --------------------------------------------------
let pendingRestart = false;
function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    audio.unlock();
    if (pendingRestart || rounds.state.phase === 'match') {
      pendingRestart = false;
      restartMatch();
    } else if (!state.started) {
      startMatch();
    }
    hud.hideOverlay();
  } else if (state.started && (rounds.state.phase === 'live' || rounds.state.phase === 'planted') && !state.buyOpen && playerFighter.alive) {
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  if (rounds.state.phase === 'match') pendingRestart = true;
  input.requestLock();
});

// ---- plant / defuse ----------------------------------------------------------
function stepObjective(dt) {
  const phase = rounds.state.phase;
  const c = state.charge;
  // Pickup: a dropped charge is claimed by walking over it.
  if (c.mode === 'dropped') {
    for (const f of fighters) {
      if (!f.alive || f.team !== rounds.attackerTeam()) continue;
      if (Math.hypot(f.pos.x - c.x, f.pos.z - c.z) < 1.3) {
        c.mode = 'carried';
        c.carrier = f;
        chargeMesh.visible = false;
        hud.radio(`${f.name} picked up the charge`);
        break;
      }
    }
  }
  // Plant: the carrier holds E inside a site.
  if (phase === 'live' && c.mode === 'carried' && c.carrier === playerFighter && playerIsAttacker()) {
    const site = siteAt(body.position.x, body.position.z);
    if (site && input.state.keys.has('KeyE')) {
      state.plantHold += dt;
      hud.showProgress('PLANTING THE CHARGE', state.plantHold / MATCH.PLANT_SECONDS);
      if (Math.floor(state.plantHold * 4) !== Math.floor((state.plantHold - dt) * 4)) audio.plantBeep();
      if (state.plantHold >= MATCH.PLANT_SECONDS) {
        c.x = body.position.x;
        c.z = body.position.z;
        c.mode = 'planted';
        playerFighter.cash += ECONOMY.PLANT;
        hud.setCash(playerFighter.cash);
        hud.hideProgress();
        state.plantHold = 0;
        handleRoundEvent(rounds.plant(site));
      }
    } else {
      if (state.plantHold > 0) hud.hideProgress();
      state.plantHold = 0;
    }
  }
  // A bot carrier plants when it reaches its site.
  if (phase === 'live' && c.mode === 'carried' && c.carrier && !c.carrier.isPlayer) {
    const bot = c.carrier;
    const site = siteAt(bot.pos.x, bot.pos.z);
    if (site && bot.alive) {
      c.plantT += dt;
      if (c.plantT > 0.2) hud.showProgress(`${bot.name.toUpperCase()} IS PLANTING`, Math.min(1, c.plantT / MATCH.PLANT_SECONDS));
      if (c.plantT >= MATCH.PLANT_SECONDS) {
        c.x = bot.pos.x;
        c.z = bot.pos.z;
        hud.hideProgress();
        handleRoundEvent(rounds.plant(site));
      }
    } else {
      c.plantT = 0;
      hud.hideProgress();
    }
  }
  // Defuse: a defender holds E at the planted charge.
  if (phase === 'planted' && c.mode === 'planted') {
    const need = playerFighter.kit ? MATCH.DEFUSE_KIT_SECONDS : MATCH.DEFUSE_SECONDS;
    if (playerFighter.alive && !playerIsAttacker() && Math.hypot(body.position.x - c.x, body.position.z - c.z) < 1.8 && input.state.keys.has('KeyE')) {
      state.defuseHold += dt;
      hud.showProgress('DEFUSING THE CHARGE', state.defuseHold / need);
      if (state.defuseHold >= need) {
        hud.hideProgress();
        state.defuseHold = 0;
        playerFighter.cash += ECONOMY.DEFUSE;
        hud.setCash(playerFighter.cash);
        for (const ev of rounds.defuseDone()) handleRoundEvent(ev);
      }
    } else {
      if (state.defuseHold > 0) hud.hideProgress();
      state.defuseHold = 0;
    }
    // A defender bot defuses when it reaches the charge.
    for (const b of bots.bots) {
      if (!b.alive || b.team !== rounds.defenderTeam()) continue;
      if (Math.hypot(b.pos.x - c.x, b.pos.z - c.z) < 1.6) {
        c.defuseT += dt;
        c.defuser = b;
        hud.showProgress(`${b.name.toUpperCase()} IS DEFUSING`, Math.min(1, c.defuseT / MATCH.DEFUSE_SECONDS));
        if (c.defuseT >= MATCH.DEFUSE_SECONDS) {
          hud.hideProgress();
          c.defuseT = 0;
          for (const ev of rounds.defuseDone()) handleRoundEvent(ev);
        }
        break;
      }
    }
    if (!bots.bots.some((b) => b.alive && b.team === rounds.defenderTeam() && Math.hypot(b.pos.x - c.x, b.pos.z - c.z) < 1.6)) {
      c.defuseT = 0;
      c.defuser = null;
    }
    // Planted-charge beep, faster as the fuse runs down.
    chargeBeep.t += dt;
    const interval = rounds.state.fuseT > 10 ? 1 : 0.5;
    if (chargeBeep.t > interval) {
      chargeBeep.t = 0;
      audio.defuseBeep();
    }
    chargeMesh.userData.light.intensity = 4 + 4 * Math.sin(state.time * 8);
  }
}

// ---- per-frame simulation ----------------------------------------------------
function step(dt) {
  state.time += dt;
  // Fresh world matrices for every raycast this step (shots and bot sight both
  // read them; in shot mode no render has run yet, so stale matrices would miss).
  scene.updateMatrixWorld();
  world.step(dt, state.time);
  fx.step(dt);

  const phase = rounds.state.phase;
  const events = rounds.update(dt, aliveCounts());
  for (const ev of events) handleRoundEvent(ev);

  if (phase === 'buy' || phase === 'live' || phase === 'planted') {
    // Player movement and look.
    const look = input.takeLook();
    if (playerFighter.alive) player.look(look.x, look.y);
    if (playerFighter.alive && phase !== 'buy') player.step(dt, input.state.keys);
    else if (playerFighter.alive) player.step(dt, new Set());

    // Keys pressed this frame.
    let clickEdge = false;
    for (const code of input.takePressed()) {
      if (code === 'Mouse0') clickEdge = true;
      else if (code === 'KeyB') {
        if (state.buyOpen) closeBuy();
        else openBuy();
      } else if (code === 'KeyR') {
        if (weapons.reload()) audio.reload();
      } else if (code === 'Digit1') weapons.selectSlot(1);
      else if (code === 'Digit2') weapons.selectSlot(2);
      else if (code === 'Digit3') weapons.selectSlot(3);
      else if (code === 'KeyG') throwGrenade();
      else if (code === 'KeyQ') weapons.selectSlot(weapons.inv.slot === 1 ? 2 : 1);
      else if (code === 'Tab') { /* held: handled below */ }
    }
    if (input.state.keys.has('Tab')) {
      if (!state.boardOpen) {
        state.boardOpen = true;
        hud.showScoreboard(scoreRows(), `ROUND ${rounds.state.round} — ${TEAMS.embers.name} ${rounds.state.score.embers} : ${rounds.state.score.night} ${TEAMS.night.name}`);
      }
    } else if (state.boardOpen) {
      state.boardOpen = false;
      hud.hideScoreboard();
    }

    // Firing: automatics fire while held, semi-autos only on the click edge.
    if (playerFighter.alive && phase !== 'buy') {
      const def = weapons.current();
      if (def && weapons.ready() && (def.def.auto ? input.state.firing : clickEdge)) playerShoot();
    }
    weapons.step(dt);

    // Bots only move and fight once the round is live.
    if (phase === 'live' || phase === 'planted') {
      const ctx = {
        fighters,
        time: state.time,
        sounds: state.sounds,
        los: (x, y, z, to) => losClear(x, y, z, to),
        shootBot: (bot, ls, spread) => botShoot(bot, ls, spread),
        radio: (text) => hud.radio(text),
      };
      bots.step(dt, state.time, ctx);
    }
    for (const f of fighters) {
      if (state.time - f.firedAt > 0.6) f.firedRecently = false;
    }
    state.sounds = state.sounds.filter((s) => state.time - s.t < 0.5);

    stepGrenades(dt);
    stepObjective(dt);

    // Player hitbox follows the body (torso at y 1.08, head at y 1.58).
    playerHit.torso.position.set(body.position.x, 1.08, body.position.z);
    playerHit.head.position.set(body.position.x, 1.58, body.position.z);
    playerHit.torso.rotation.y = body.yaw;
    playerHit.head.rotation.y = body.yaw;
  }

  syncCamera();
  updateHud();
}

function syncCamera() {
  if (playerFighter.alive || !state.spectate) {
    camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
    camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  } else {
    const s = state.spectate;
    camera.position.set(s.pos.x, s.pos.y + 1.55, s.pos.z);
    camera.rotation.set(-0.08, s.yaw, 0, 'YXZ');
  }
}

function updateHud() {
  const r = rounds.state;
  hud.setScore(r.score.embers, r.score.night);
  hud.setRound(r.round, MATCH.ROUNDS_MAX);
  hud.setTimer(rounds.timerText());
  hud.setPhase(r.phase === 'buy' ? 'BUY PHASE' : r.phase === 'live' ? 'LIVE' : r.phase === 'planted' ? 'CHARGE PLANTED' : r.phase.toUpperCase());
  const counts = aliveCounts();
  hud.setPips(counts.embers, counts.night);
  hud.setHealth(playerFighter.hp, Math.ceil(playerFighter.armor), playerFighter.helmet);
  hud.setCash(playerFighter.cash);
  const def = weapons.current();
  if (def) hud.setWeapon(def.def.name, def.def.auto ? 'AUTO' : 'SEMI', weapons.inv.mag, weapons.inv.reserve);
  else if (weapons.inv.slot === 3) hud.setWeapon(`${GRENADES[weapons.inv.grenadeSel].name}`, 'THROW', weapons.grenadeCount(weapons.inv.grenadeSel), 0);
  else hud.setWeapon('—', '', 0, 0);
  hud.setSlots(weapons.inv.slot, weapons.inv.grenades);
  const spread = weapons.spread(player.groundSpeed(), body.crouching, input.state.keys.has('ShiftLeft'));
  const stance = body.crouching ? 'CROUCHED' : player.moving() ? (input.state.keys.has('ShiftLeft') ? 'AIMING' : 'MOVING') : 'STANDING';
  hud.setSpread(`${stance} · SPREAD ${(spread * 100).toFixed(1)}`);
  hud.setLocation(CALLOUTS[calloutAt(body.position.x, body.position.z)]);
  const hint = r.phase === 'buy' ? 'BUY PHASE — B opens the shop, the round starts soon'
    : r.phase === 'planted' ? (playerIsAttacker() ? `Charge planted at ${state.charge.site} — defend it` : `Charge planted at ${state.charge.site} — defuse it (E)`)
    : playerIsAttacker() ? (state.charge.carrier === playerFighter ? 'You carry the charge — plant at A or B (hold E)' : `${state.charge.carrier?.name ?? 'A teammate'} carries the charge — escort them`)
    : 'Hold the sites — stop the plant';
  hud.setHint(hint);
  const chargeText = state.charge.mode === 'carried' && state.charge.carrier === playerFighter ? '◈ YOU CARRY THE CHARGE'
    : state.charge.mode === 'dropped' ? '◈ CHARGE DROPPED — PICK IT UP'
    : state.charge.mode === 'planted' ? `◈ CHARGE PLANTED AT ${state.charge.site} — ${Math.max(0, rounds.state.fuseT).toFixed(0)}s`
    : null;
  hud.setCharge(chargeText);
  state.minimapT -= 1 / 60;
  if (state.minimapT <= 0) {
    state.minimapT = 0.15;
    hud.drawMinimap(fighters, state.charge.mode === 'planted' ? { state: 'planted', x: state.charge.x, z: state.charge.z } : null, world.sites, playerFighter.team);
  }
}

// ---- main loop ---------------------------------------------------------------
let accumulator = 0;
let lastTime = performance.now();
let frozen = false;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
  }
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- deterministic screenshot setups -----------------------------------------
function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function aimAt(x, y, z) {
  const dx = x - body.position.x;
  const dy = y - (body.position.y + body.eye);
  const dz = z - body.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function runShot(name) {
  hud.hideOverlay();
  state.started = true;
  rounds.beginMatch();
  rounds.state.round = name === 'score' ? 12 : name === 'plant' ? 4 : name === 'buy' ? 2 : 3;
  rounds.state.score = name === 'score' ? { embers: 7, night: 4 } : name === 'buy' ? { embers: 1, night: 0 } : { embers: 2, night: 1 };
  rounds.state.phase = name === 'buy' ? 'buy' : name === 'score' ? 'match' : name === 'plant' ? 'live' : 'live';
  rounds.state.phaseT = name === 'buy' ? 8 : 62;
  resetFighterPositions();
  assignPlans();
  weapons.reset();
  weapons.give('pistol');
  weapons.give('rifle');
  owned.weapons = ['pistol', 'rifle'];
  owned.gear = ['vest'];
  owned.grenades = { frag: 1, smoke: 1, flash: 1 };
  weapons.giveGrenade('frag');
  weapons.giveGrenade('smoke');
  weapons.giveGrenade('flash');
  playerFighter.cash = name === 'buy' ? 4700 : 2150;
  playerFighter.armor = 50;
  playerFighter.hp = name === 'combat' ? 78 : 100;

  if (name === 'combat') {
    // Mid-round firefight: two Nightwatch bots in the plaza, one friendly covering.
    // Bots hold their staged spots so the aim stays true through the settle.
    const agus = fighters.find((f) => f.name === 'Agus');
    const maya = fighters.find((f) => f.name === 'Maya');
    const rani = fighters.find((f) => f.name === 'Rani');
    player.teleport(0.5, 8.5, Math.PI);
    agus.pos.set(-3.5, 0, -3.5);
    agus.yaw = 0;
    agus.mode = 'hold';
    agus.anchor = [-3.5, -3.5];
    agus.route = [];
    maya.pos.set(3.2, 0, -5);
    maya.yaw = Math.PI * 0.8;
    maya.mode = 'hold';
    maya.anchor = [3.2, -5];
    maya.route = [];
    rani.pos.set(-2.5, 0, 6);
    rani.yaw = Math.PI;
    rani.mode = 'hold';
    rani.anchor = [-2.5, 6];
    rani.route = [];
    settle(10);
    aimAt(agus.pos.x, 1.2, agus.pos.z);
    // A real shot: tracer, muzzle flash and a hit on Agus.
    playerShoot();
    hud.killFeed({ name: 'Rani', team: 'embers' }, { name: 'Joko', team: 'night' }, false, 'Bambu AR-77');
    hud.radio('Contact Mid — two on the plaza');
    hud.radio('Rani: pushing Long A, cover me');
    weapons.inv.mag = 24;
    settle(1);
  } else if (name === 'buy') {
    player.teleport(0, 15, Math.PI);
    settle(6);
    hud.showBuy(playerFighter.cash, ownedSnapshot());
    hud.radio('Plan: SPLIT A — you carry the charge');
  } else if (name === 'plant') {
    player.teleport(-15, -9.5, Math.PI);
    state.charge.mode = 'carried';
    state.charge.carrier = playerFighter;
    state.charge.x = -15;
    state.charge.z = -11;
    const maya = fighters.find((f) => f.name === 'Maya');
    maya.pos.set(-12, 0, -13);
    maya.yaw = Math.PI * 0.5;
    maya.mode = 'hold';
    maya.anchor = [-12, -13];
    maya.route = [];
    settle(6);
    aimAt(-15, 1.0, -13.5);
    state.plantHold = MATCH.PLANT_SECONDS * 0.62;
    hud.showProgress('PLANTING THE CHARGE', 0.62);
    hud.banner('PLANTING THE CHARGE', 'Hold E — Site A', 4000);
  } else if (name === 'score') {
    rounds.state.matchOver = true;
    rounds.state.winner = 'embers';
    playerFighter.stats = { k: 14, d: 6, a: 4, hs: 5, dmg: 1840 };
    for (const f of fighters) {
      if (f.isPlayer) continue;
      f.stats = { k: 3 + (f.id % 5), d: 4 + (f.id % 4), a: 1 + (f.id % 3), hs: f.id % 3, dmg: 400 + f.id * 137 };
      f.cash = 1200 + f.id * 300;
    }
    playerFighter.cash = 6850;
    hud.showScoreboard(scoreRows(), 'EMBERS WIN THE MARKET  7 – 4');
    hud.banner('EMBERS WIN THE MARKET', 'Final score 7 – 4 · Lentera Night Market', 6000);
    player.teleport(0, 10, Math.PI);
    settle(4);
  }
  updateHud();
  paintTwiceThenReady();
}

// ---- boot --------------------------------------------------------------------
syncCamera();
hud.showOverlay('start');
if (shot) runShot(shot);
else {
  requestAnimationFrame(frame);
  window.__gameReady = true;
}
window.__game = { state, rounds, fighters, playerFighter, world, camera, raycaster, shootList, losClear };
