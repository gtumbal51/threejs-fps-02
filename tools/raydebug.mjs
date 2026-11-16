// One-off ray debug: load ?shot=combat, re-cast the shot ray manually and report
// the first hit object, distance and point.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';

const server = spawn('node', ['serve.ts', '--port', '8093'], { cwd: '/home/hatch/workspace/makefun/threejs-fps-02', stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({
  executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1187/chrome-linux/chrome`,
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:8093/?shot=combat&seed=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 20000 });
const info = await page.evaluate(async () => {
  const THREE = await import('three');
  const g = window.__game;
  const agus = g.fighters.find((f) => f.name === 'Agus');
  const dir = new THREE.Vector3();
  g.camera.getWorldDirection(dir);
  const rc = new THREE.Raycaster();
  rc.set(g.camera.position, dir);
  rc.far = 90;
  const hits = rc.intersectObjects(g.shootList, false).slice(0, 4).map((h) => ({
    dist: +h.distance.toFixed(2),
    point: h.point.toArray().map((v) => +v.toFixed(2)),
    bot: h.object.userData.bot?.name ?? null,
    fighter: h.object.userData.fighter?.name ?? null,
    part: h.object.userData.part ?? null,
    pos: h.object.position.toArray().map((v) => +v.toFixed(2)),
  }));
  return {
    camPos: g.camera.position.toArray().map((v) => +v.toFixed(2)),
    dir: dir.toArray().map((v) => +v.toFixed(3)),
    agusPos: agus.pos.toArray().map((v) => +v.toFixed(2)),
    agusHp: agus.hp,
    shootListLen: g.shootList.length,
    hits,
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
server.kill();
