// The weapon bench: one inventory per fighter, view models built from boxes, and the
// firing state (magazine, reserve, cooldown, reload, kick, muzzle flash). Spread is a
// function of stance and speed, so stopping to aim demonstrably pays: still and
// crouched is ~0.002 rad, sprinting is ten times worse. Grenades live in slot 3 and
// cycle with repeated presses. main.js owns the ray and the damage; this module owns
// the numbers and the model in the player's hands.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WEAPONS, GRENADES } from './config.js';

const GRENADE_ORDER = ['frag', 'smoke', 'flash', 'fire'];

export function createWeapons(camera) {
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.wall), roughness: 0.55, metalness: 0.35 });
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.wood), roughness: 0.8, metalness: 0.05 });
  const steel = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.4, metalness: 0.5 });
  const ember = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.lantern), roughness: 0.5, metalness: 0.2 });

  function box(w, h, d, x, y, z, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
  }

  function buildModel(id) {
    const g = new THREE.Group();
    if (id === 'pistol') {
      g.add(box(0.05, 0.09, 0.2, 0, 0, -0.08, steel));
      g.add(box(0.045, 0.1, 0.07, 0, -0.08, 0.02, grip));
      g.add(box(0.02, 0.02, 0.05, 0, 0.055, -0.16, ember));
    } else if (id === 'smg') {
      g.add(box(0.07, 0.09, 0.3, 0, 0, -0.1, dark));
      g.add(box(0.04, 0.04, 0.3, 0, 0.02, -0.36, steel));
      g.add(box(0.05, 0.14, 0.06, 0, -0.1, -0.02, grip));
      g.add(box(0.05, 0.12, 0.05, 0, -0.09, 0.1, grip));
    } else if (id === 'shotgun') {
      g.add(box(0.08, 0.1, 0.5, 0, 0, -0.16, grip));
      g.add(box(0.06, 0.06, 0.55, 0, 0.03, -0.5, steel));
      g.add(box(0.06, 0.08, 0.2, 0, -0.02, 0.16, dark));
    } else if (id === 'sniper') {
      g.add(box(0.07, 0.09, 0.44, 0, 0, -0.12, dark));
      g.add(box(0.035, 0.035, 0.62, 0, 0.03, -0.55, steel));
      g.add(box(0.05, 0.05, 0.16, 0, 0.07, -0.14, steel));
      g.add(box(0.06, 0.1, 0.18, 0, -0.03, 0.14, grip));
    } else {
      g.add(box(0.08, 0.1, 0.42, 0, 0, -0.14, dark));
      g.add(box(0.045, 0.045, 0.42, 0, 0.025, -0.5, steel));
      g.add(box(0.07, 0.13, 0.06, 0, -0.1, -0.04, grip));
      g.add(box(0.07, 0.08, 0.2, 0, -0.02, 0.16, grip));
      g.add(box(0.02, 0.02, 0.06, 0, 0.06, -0.3, ember));
    }
    return g;
  }

  const models = {};
  for (const id of Object.keys(WEAPONS)) {
    models[id] = buildModel(id);
    models[id].visible = false;
    models[id].position.set(0.24, -0.21, -0.45);
    camera.add(models[id]);
  }
  const grenadeModel = new THREE.Group();
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.coral), roughness: 0.5 }));
  const pin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.02), steel);
  pin.position.y = 0.07;
  grenadeModel.add(orb, pin);
  grenadeModel.position.set(0.24, -0.21, -0.45);
  grenadeModel.visible = false;
  camera.add(grenadeModel);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.lantern), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.19, -0.98);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.lantern), 0, 6);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const inv = {
    primary: null, pistol: null, grenades: {}, grenadeSel: 'frag',
    slot: 1, mag: 0, reserve: 0, cooldown: 0, reloadLeft: 0, flash: 0, kick: 0,
  };

  function currentDef() {
    if (inv.slot === 3) return null;
    return inv.slot === 1 ? inv.primary : inv.pistol;
  }

  function showModel() {
    for (const id of Object.keys(models)) models[id].visible = false;
    grenadeModel.visible = false;
    const def = currentDef();
    if (inv.slot === 3) grenadeModel.visible = true;
    else if (def) models[def.id].visible = true;
  }

  function loadWeapon(id) {
    const def = WEAPONS[id];
    return { id, def, mag: def.mag, reserve: def.reserve };
  }

  function step(dt) {
    inv.cooldown = Math.max(0, inv.cooldown - dt);
    inv.flash = Math.max(0, inv.flash - dt);
    inv.kick += (0 - inv.kick) * Math.min(1, dt * 15);
    const def = currentDef();
    const model = inv.slot === 3 ? grenadeModel : def ? models[def.id] : null;
    if (model) {
      model.position.z = -0.45 + inv.kick;
      model.rotation.x = inv.kick * 2.4;
    }
    flash.visible = inv.flash > 0;
    flash.rotation.z = inv.flash * 28;
    flashLight.intensity = inv.flash > 0 ? 16 : 0;
    if (inv.reloadLeft > 0 && def) {
      inv.reloadLeft = Math.max(0, inv.reloadLeft - dt);
      if (model) model.rotation.x = -0.6 * Math.min(1, (def.reload - inv.reloadLeft) * 2);
      if (inv.reloadLeft === 0) {
        const w = inv.slot === 1 ? inv.primary : inv.pistol;
        const need = w.def.mag - w.mag;
        const take = Math.min(need, w.reserve);
        w.mag += take;
        w.reserve -= take;
        inv.mag = w.mag;
        inv.reserve = w.reserve;
      }
    }
  }

  return {
    inv,
    step,
    give(id) {
      const w = loadWeapon(id);
      if (w.def.slot === 1) inv.primary = w;
      else inv.pistol = w;
      inv.slot = w.def.slot;
      inv.mag = w.mag;
      inv.reserve = w.reserve;
      inv.reloadLeft = 0;
      inv.cooldown = 0;
      showModel();
    },
    giveGrenade(id) {
      inv.grenades[id] = (inv.grenades[id] ?? 0) + 1;
    },
    takeGrenade(id) {
      if (!inv.grenades[id]) return false;
      inv.grenades[id] -= 1;
      return true;
    },
    grenadeCount(id) {
      return inv.grenades[id] ?? 0;
    },
    selectSlot(slot) {
      if (slot === 1 && !inv.primary) return false;
      if (slot === 2 && !inv.pistol) return false;
      if (slot === 3) {
        const owned = GRENADE_ORDER.filter((g) => (inv.grenades[g] ?? 0) > 0);
        if (!owned.length) return false;
        const at = owned.indexOf(inv.grenadeSel);
        inv.grenadeSel = owned[(at + 1) % owned.length];
      }
      inv.slot = slot;
      const w = currentDef();
      if (w) {
        inv.mag = w.mag;
        inv.reserve = w.reserve;
      }
      inv.reloadLeft = 0;
      showModel();
      return true;
    },
    selectedGrenade() {
      return inv.slot === 3 ? inv.grenadeSel : null;
    },
    current() {
      return currentDef();
    },
    ready() {
      const w = currentDef();
      return !!w && inv.mag > 0 && inv.cooldown === 0 && inv.reloadLeft === 0;
    },
    reloading() {
      return inv.reloadLeft > 0;
    },
    pullTrigger() {
      const w = currentDef();
      if (!w) return;
      inv.cooldown = 60 / w.def.rpm;
      inv.flash = 0.055;
      inv.kick = w.def.id === 'sniper' ? 0.09 : w.def.id === 'shotgun' ? 0.08 : 0.05;
    },
    takeRound() {
      if (inv.mag <= 0) return false;
      inv.mag -= 1;
      const w = currentDef();
      if (w) w.mag = inv.mag;
      return true;
    },
    reload() {
      const w = currentDef();
      if (!w || inv.reloadLeft > 0 || w.mag === w.def.mag || w.reserve === 0) return false;
      inv.reloadLeft = w.def.reload;
      return true;
    },
    spread(speed, crouched, aiming) {
      const w = currentDef();
      if (!w) return 0.01;
      const move = Math.min(1, speed / 5.4);
      let s = w.def.spreadStill + move * w.def.spreadMove;
      if (crouched) s *= 0.55;
      if (aiming) s *= 0.6;
      return s;
    },
    refillAmmo() {
      for (const w of [inv.primary, inv.pistol]) {
        if (!w) continue;
        w.mag = w.def.mag;
        w.reserve = w.def.reserve;
      }
      const w = currentDef();
      if (w) {
        inv.mag = w.mag;
        inv.reserve = w.reserve;
      }
    },
    reset() {
      inv.primary = null;
      inv.pistol = null;
      inv.grenades = {};
      inv.grenadeSel = 'frag';
      inv.slot = 1;
      inv.mag = 0;
      inv.reserve = 0;
      inv.cooldown = 0;
      inv.reloadLeft = 0;
      inv.flash = 0;
      inv.kick = 0;
      showModel();
    },
  };
}

export { GRENADES };
