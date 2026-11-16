// Lentera Night Market: one invented place. A walled night-market courtyard, 44 x 36 m,
// stalls and crates for cover, two bomb sites at the north end (A west, B east), three
// lanes south to north (Long A, Mid, Short B) and a lantern plaza in the middle. All art
// is boxes, cylinders and canvas-painted signs made at runtime — no loaded assets.
// Every box is both a collider and a bullet stop. Waypoints are the bot routes.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

function textTexture(text, bg, fg, w = 512, h = 128, font = 700) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.font = `${font} ${Math.floor(h * 0.52)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const mats = {};
  for (const name of Object.keys(PALETTE)) {
    mats[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'lantern' || name === 'coral' ? 0.5 : 0.92,
      metalness: 0.03,
    });
  }
  const emissiveLantern = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.lantern), emissive: new THREE.Color(PALETTE.lantern), emissiveIntensity: 1.6, roughness: 0.4 });
  const emissiveCoral = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.coral), emissive: new THREE.Color(PALETTE.coral), emissiveIntensity: 0.9, roughness: 0.5 });

  const colliders = [];
  const shootables = [];
  const minimapRects = [];
  const lanterns = [];

  function box(w, h, d, x, y, z, mat, opts = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[mat] ?? mats.wall);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (!opts.noCollide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      minimapRects.push([x - w / 2, z - d / 2, w, d]);
    }
    if (!opts.noShoot) shootables.push(mesh);
    return mesh;
  }

  function sign(text, w, h, x, y, z, ry, bg, fg, flat = false) {
    const tex = textTexture(text, bg, fg, 512, Math.round(512 * h / w));
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: false }),
    );
    mesh.position.set(x, y, z);
    if (flat) mesh.rotation.x = -Math.PI / 2;
    else mesh.rotation.y = ry;
    group.add(mesh);
    return mesh;
  }

  function stall(x, z, ry, awning, label) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    const counter = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.05, 1.1), mats.wood);
    counter.position.y = 0.52;
    counter.castShadow = true;
    counter.receiveShadow = true;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.1, 1.5), new THREE.MeshStandardMaterial({ color: new THREE.Color(awning), roughness: 0.8 }));
    roof.position.y = 2.15;
    roof.castShadow = true;
    const postA = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.1, 0.09), mats.wood);
    postA.position.set(-1.1, 1.05, 0.6);
    const postB = postA.clone();
    postB.position.x = 1.1;
    const goods = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.35, 0.8), mats[awning === '#1f7a6d' ? 'coral' : 'awning']);
    goods.position.y = 1.25;
    g.add(counter, roof, postA, postB, goods);
    group.add(g);
    const c = new THREE.Box3().setFromObject(counter);
    colliders.push(c);
    minimapRects.push([x - 1.1, z - 0.55, 2.2, 1.1]);
    shootables.push(counter, roof);
    const tex = textTexture(label, '#0d1420', awning, 512, 96);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.38), new THREE.MeshBasicMaterial({ map: tex }));
    board.position.set(x, 2.5, z + (ry === 0 ? 0.78 : 0));
    if (ry !== 0) board.rotation.y = ry;
    group.add(board);
    return g;
  }

  function lantern(x, y, z, light) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), emissiveLantern);
    mesh.position.set(x, y, z);
    group.add(mesh);
    lanterns.push({ mesh, baseY: y, phase: Math.random() * 6.28 });
    if (light) {
      const p = new THREE.PointLight(new THREE.Color(PALETTE.lantern), 14, 13, 1.8);
      p.position.set(x, y, z);
      scene.add(p);
      lanterns.push({ light: p, base: 14, phase: Math.random() * 6.28 });
    }
    return mesh;
  }

  // Floor and perimeter walls (44 x 36, 4.6 m high).
  box(44.4, 0.4, 36.4, 0, -0.2, 0, 'floor');
  box(0.5, 4.6, 36.4, -22.2, 2.3, 0, 'wall');
  box(0.5, 4.6, 36.4, 22.2, 2.3, 0, 'wall');
  box(44.4, 4.6, 0.5, 0, 2.3, -18.2, 'wall');
  box(44.4, 4.6, 0.5, 0, 2.3, 18.2, 'wall');

  // Interior walls: corners and sightline breaks around the sites.
  box(0.5, 3.4, 7, -10, 1.7, -6, 'wall');
  box(0.5, 3.4, 7, 10, 1.7, -6, 'wall');
  box(7, 3.4, 0.5, -6.5, 1.7, -11, 'wall');
  box(7, 3.4, 0.5, 6.5, 1.7, -11, 'wall');
  box(0.5, 3.4, 5, -13, 1.7, 8, 'wall');
  box(0.5, 3.4, 5, 13, 1.7, 8, 'wall');

  // Stalls: two rows flanking Mid, clusters at both sites.
  stall(-7, -2, 0, '#1f7a6d', 'IKAN BAKAR');
  stall(-7, 3, 0, '#e4572e', 'SATE AYAM');
  stall(-7, 8, 0, '#1f7a6d', 'TEH MELATI');
  stall(7, -2, 0, '#e4572e', 'REMPAH');
  stall(7, 3, 0, '#1f7a6d', 'BATIK');
  stall(7, 8, 0, '#e4572e', 'BUAH');
  stall(-16, -14, 0, '#1f7a6d', 'SITE A · IKAN');
  stall(-12, -15, 0, '#e4572e', 'SITE A · ES');
  stall(16, -14, 0, '#e4572e', 'SITE B · REMPAH');
  stall(12, -15, 0, '#1f7a6d', 'SITE B · KOPI');
  stall(-17, 12, 0, '#1f7a6d', 'LONTONG');
  stall(17, 12, 0, '#e4572e', 'GORENGAN');

  // Crates and barrels for crouch cover.
  const crateSpots = [[-4, -1], [4, -1], [-3, 6], [3, 6], [-16, -6], [16, -6], [-11, -13], [11, -13], [0, -13], [-19, 2], [19, 2]];
  for (const [x, z] of crateSpots) box(1.1, 1.1, 1.1, x, 0.55, z, 'wood');
  box(2.2, 1.1, 1.1, -4, 0.55, -8, 'wood');
  box(2.2, 1.1, 1.1, 4, 0.55, -8, 'wood');
  box(1.1, 2.2, 1.1, -19, 1.1, -11, 'wood');
  box(1.1, 2.2, 1.1, 19, 1.1, -11, 'wood');

  // Lantern plaza: a fountain ring and the arch at Mid.
  const fountain = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 0.7, 16), mats.wall);
  fountain.position.set(0, 0.35, 1);
  fountain.castShadow = true;
  fountain.receiveShadow = true;
  group.add(fountain);
  colliders.push(new THREE.Box3().setFromObject(fountain));
  minimapRects.push([-1.8, -0.8, 3.6, 3.6]);
  shootables.push(fountain);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 4.4, 0.35), mats.wood);
    post.position.set(sx * 3.1, 2.2, -1.5);
    post.castShadow = true;
    group.add(post);
    colliders.push(new THREE.Box3().setFromObject(post));
    shootables.push(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.4, 0.4), mats.wood);
  beam.position.set(0, 4.4, -1.5);
  group.add(beam);
  sign('LENTERA', 5.4, 1.1, 0, 3.9, -1.28, 0, '#0d1420', '#ffb347');
  sign('LENTERA', 5.4, 1.1, 0, 3.9, -1.72, Math.PI, '#0d1420', '#ffb347');

  // Big painted site letters on the north wall, plus site floor paint.
  sign('A', 3.4, 3.4, -15, 2.6, -17.9, 0, '#e4572e', '#f2ead8');
  sign('B', 3.4, 3.4, 15, 2.6, -17.9, 0, '#1f7a6d', '#f2ead8');
  sign('A', 3.0, 3.0, -15, 0.03, -11, 0, '#e4572e', '#f2ead8', true);
  sign('B', 3.0, 3.0, 15, 0.03, -11, 0, '#1f7a6d', '#f2ead8', true);

  // Lanterns: warm pools of light down Mid and over both sites.
  lantern(0, 3.2, -1.5, true);
  lantern(-7, 3.0, 3, true);
  lantern(7, 3.0, 3, true);
  lantern(-15, 3.2, -11, true);
  lantern(15, 3.2, -11, true);
  lantern(0, 3.2, 12, false);
  lantern(-17, 2.8, 6, false);
  lantern(17, 2.8, 6, false);
  lantern(-15, 2.8, -15, false);
  lantern(15, 2.8, -15, false);

  // Night lighting: cool moon key, dim blue sky fill.
  scene.add(new THREE.HemisphereLight(new THREE.Color('#2a3a55'), new THREE.Color('#0d1420'), 0.85));
  const moon = new THREE.DirectionalLight(new THREE.Color('#bcd2ff'), 1.5);
  moon.position.set(10, 18, 6);
  moon.target.position.set(0, 0, -2);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -26;
  moon.shadow.camera.right = 26;
  moon.shadow.camera.top = 24;
  moon.shadow.camera.bottom = -24;
  moon.shadow.camera.far = 60;
  moon.shadow.bias = -0.0006;
  scene.add(moon, moon.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#8b98a8'), 0.35);
  fill.position.set(-9, 10, 12);
  scene.add(fill);

  const sites = {
    A: { x: -15, z: -11, r: 4.6 },
    B: { x: 15, z: -11, r: 4.6 },
  };

  return {
    colliders,
    shootables,
    sites,
    minimapRects,
    bounds: { x: 22, z: 18 },
    spawns: {
      attack: [[-4, 15], [-1.5, 15.5], [1.5, 15.5], [4, 15], [0, 16.5]],
      defend: [[-6, -15], [-3, -15.5], [0, -16], [3, -15.5], [6, -15]],
    },
    routes: {
      A_long: [[0, 15], [-6, 12], [-14, 8], [-17, 2], [-17, -6], [-15, -11]],
      A_mid: [[0, 15], [0, 8], [0, 1], [-4, -6], [-10, -10], [-15, -11]],
      B_short: [[0, 15], [6, 12], [14, 8], [17, 2], [17, -6], [15, -11]],
      B_mid: [[0, 15], [0, 8], [0, 1], [4, -6], [10, -10], [15, -11]],
    },
    anchors: {
      A: [[-15, -14], [-11, -8], [-18, -8], [-13, -13]],
      B: [[15, -14], [11, -8], [18, -8], [13, -13]],
      mid: [[0, -8], [-5, -4], [5, -4], [0, -13]],
    },
    step(dt, time) {
      for (const l of lanterns) {
        if (l.mesh) l.mesh.position.y = l.baseY + Math.sin(time * 0.8 + l.phase) * 0.05;
        if (l.light) l.light.intensity = l.base * (0.92 + 0.08 * Math.sin(time * 2.1 + l.phase));
      }
    },
  };
}
