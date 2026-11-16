// Transient combat effects, all pooled: no object is created per frame in a hot loop.
// Tracers are stretched boxes that fade in 90 ms; hit sparks are small bursts; smoke
// and fire are growing translucent spheres that also change the simulation (smoke blocks
// line of sight, fire burns a zone). main.js asks the pools for a tracer or a spark and
// the pools recycle them.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACER_POOL = 24;
const SPARK_POOL = 24;

export function createFx(scene) {
  const tracers = [];
  const sparks = [];
  const clouds = [];

  const tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
  for (let i = 0; i < TRACER_POOL; i += 1) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0, depthWrite: false });
    const mesh = new THREE.Mesh(tracerGeo, mat);
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
  const sparkGeo = new THREE.SphereGeometry(0.05, 6, 5);
  for (let i = 0; i < SPARK_POOL; i += 1) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0, depthWrite: false });
    const mesh = new THREE.Mesh(sparkGeo, mat);
    mesh.visible = false;
    scene.add(mesh);
    sparks.push({ mesh, life: 0, vel: new THREE.Vector3() });
  }

  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();

  function tracer(from, to, color = 0xffe9b0) {
    const t = tracers.find((x) => x.life <= 0) ?? tracers[0];
    tmpA.copy(from);
    tmpB.copy(to);
    const len = tmpA.distanceTo(tmpB);
    if (len < 0.5) return;
    t.mesh.visible = true;
    t.mesh.material.color.setHex(color);
    t.mesh.position.copy(tmpA).lerp(tmpB, 0.5);
    t.mesh.lookAt(tmpB);
    t.mesh.scale.set(1, 1, len);
    t.mesh.material.opacity = 0.9;
    t.life = 0.09;
  }

  function spark(at, color = 0xffb347) {
    const s = sparks.find((x) => x.life <= 0) ?? sparks[0];
    s.mesh.visible = true;
    s.mesh.material.color.setHex(color);
    s.mesh.position.copy(at);
    s.mesh.scale.setScalar(1);
    s.mesh.material.opacity = 1;
    s.life = 0.16;
    s.vel.set((Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3);
  }

  function smoke(at, radius, duration) {
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.muted), transparent: true, opacity: 0.55, roughness: 1, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 14, 10), mat);
    mesh.position.copy(at);
    mesh.scale.setScalar(0.2);
    scene.add(mesh);
    clouds.push({ mesh, kind: 'smoke', x: at.x, y: at.y, z: at.z, r: radius, life: duration, max: duration });
    return clouds[clouds.length - 1];
  }

  function fire(at, radius, duration) {
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.coral), emissive: new THREE.Color(PALETTE.coral), emissiveIntensity: 1.4, transparent: true, opacity: 0.7, roughness: 0.6, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 14, 10), mat);
    mesh.position.set(at.x, 0.5, at.z);
    mesh.scale.set(1, 0.35, 1);
    scene.add(mesh);
    clouds.push({ mesh, kind: 'fire', x: at.x, y: 0.5, z: at.z, r: radius, life: duration, max: duration });
    return clouds[clouds.length - 1];
  }

  function step(dt) {
    for (const t of tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
      if (t.life <= 0) t.mesh.visible = false;
    }
    for (const s of sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.material.opacity = Math.max(0, s.life / 0.16);
      if (s.life <= 0) s.mesh.visible = false;
    }
    for (let i = clouds.length - 1; i >= 0; i -= 1) {
      const c = clouds[i];
      c.life -= dt;
      if (c.kind === 'smoke') {
        const grow = Math.min(1, (c.max - c.life) / 1.2);
        c.mesh.scale.setScalar(Math.max(0.2, grow));
        c.mesh.material.opacity = 0.55 * Math.min(1, c.life / 2);
      } else {
        c.mesh.material.opacity = 0.7 * Math.min(1, c.life / 1.5);
        c.mesh.scale.x = 1 + Math.sin(c.life * 9) * 0.06;
        c.mesh.scale.z = 1 + Math.cos(c.life * 8) * 0.06;
      }
      if (c.life <= 0) {
        scene.remove(c.mesh);
        c.mesh.material.dispose();
        c.mesh.geometry.dispose();
        clouds.splice(i, 1);
      }
    }
  }

  // True when the segment from->to passes through a live smoke cloud.
  function blockedBySmoke(from, to) {
    for (const c of clouds) {
      if (c.kind !== 'smoke' || c.life <= 0) continue;
      tmpA.subVectors(to, from);
      const lenSq = tmpA.lengthSq();
      if (lenSq === 0) continue;
      const t = Math.max(0, Math.min(1, ((c.x - from.x) * tmpA.x + (c.y - from.y) * tmpA.y + (c.z - from.z) * tmpA.z) / lenSq));
      const dx = from.x + tmpA.x * t - c.x;
      const dy = from.y + tmpA.y * t - c.y;
      const dz = from.z + tmpA.z * t - c.z;
      if (dx * dx + dy * dy + dz * dz < c.r * c.r * 0.9) return true;
    }
    return false;
  }

  return { tracer, spark, smoke, fire, step, blockedBySmoke, clouds };
}
