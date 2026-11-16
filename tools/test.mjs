// Play-test harness for Lentera (dev tooling only; never shipped in game/).
// Serves game/ on :8091, opens it in headless Chromium with SwiftShader WebGL,
// clicks through the start overlay, plays a few seconds, and takes the 4 screenshots
// from the deterministic ?shot= setups. Usage: node test.mjs [shot|play|shots]
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(new URL('.', import.meta.url)));
const GAME = ROOT;
const SHOTS = join(GAME, 'screenshots');
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1187/chrome-linux/chrome`;
const PORT = 8091;

const server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: GAME, stdio: 'pipe' });
server.stdout.on('data', (d) => process.stdout.write(`[serve] ${d}`));
server.stderr.on('data', (d) => process.stdout.write(`[serve:err] ${d}`));
await new Promise((r) => setTimeout(r, 3000));

const mode = process.argv[2] ?? 'shots';
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const errors = [];
const page = await browser.newPage({ viewport: mode === 'shots' ? { width: 1280, height: 800 } : { width: 800, height: 450 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => errors.push(`reqfail: ${r.url()} ${r.failure()?.errorText}`));

async function shot(name, file) {
  await page.goto(`http://127.0.0.1:${PORT}/?shot=${name}&seed=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 20000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOTS, file), type: 'jpeg', quality: 82 });
  console.log(`shot ${name} -> ${file}`);
}

if (mode === 'shots' || mode === 'shot') {
  await shot('combat', '1-combat.jpg');
  // The combat setup fires a real shot at Agus: verify it landed.
  const dmg = await page.evaluate(() => {
    const g = window.__game;
    const agus = g.fighters.find((f) => f.name === 'Agus');
    return { agusHp: Math.round(agus.hp), mag: document.querySelector('#mag').textContent, feed: document.querySelectorAll('#killfeed .feed-item').length };
  });
  console.log('combat shot landed:', JSON.stringify(dmg));
  await shot('buy', '2-buy.jpg');
  await shot('plant', '3-plant.jpg');
  await shot('score', '4-score.jpg');
} else if (mode === 'combat') {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__gameReady === true, null, { timeout: 20000 });
  await page.click('#play');
  await page.waitForTimeout(1000);
  await page.keyboard.press('KeyB'); // close buy menu
  // Force the round live immediately by shrinking the buy timer, then stage a duel.
  await page.evaluate(() => { window.__game.rounds.state.phaseT = 0.5; });
  await page.waitForFunction(() => window.__game.rounds.state.phase === 'live', null, { timeout: 60000 });
  await page.evaluate(() => {
    const g = window.__game;
    const agus = g.fighters.find((f) => f.name === 'Agus');
    // Duel in the Long A corridor (no fountain between them): player south, Agus north.
    g.playerFighter.pos.set(-17, 0, 2);
    agus.pos.set(-17, 0, -5);
    agus.yaw = Math.PI;
    agus.mode = 'hold';
    agus.anchor = [-17, -5];
    agus.route = [];
  });
  const hp0 = await page.evaluate(() => Math.round(window.__game.playerFighter.hp));
  console.log('player hp before duel:', hp0);
  // Wait for the bot to react and shoot (sim runs ~0.3x wall in headless).
  await page.waitForTimeout(15000);
  const after = await page.evaluate(() => {
    const g = window.__game;
    const agus = g.fighters.find((f) => f.name === 'Agus');
    return { hp: Math.round(g.playerFighter.hp), agusHp: Math.round(agus.hp), agusFiredAt: agus.firedAt.toFixed(1), sim: g.state.time.toFixed(1), feed: document.querySelectorAll('#killfeed .feed-item').length };
  });
  console.log('after 15s duel:', JSON.stringify(after));
  // Now the player shoots back: the player already faces north (yaw 0) and Agus is
  // straight ahead, so clicks fire down the lane at him. Clicks are spaced out because
  // headless sim time runs ~0.3x wall time.
  for (let i = 0; i < 10; i += 1) {
    await page.mouse.down();
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(1200);
  }
  const final = await page.evaluate(() => {
    const g = window.__game;
    const agus = g.fighters.find((f) => f.name === 'Agus');
    return { playerHp: Math.round(g.playerFighter.hp), agusHp: Math.round(agus.hp), agusAlive: agus.alive, mag: document.querySelector('#mag').textContent };
  });
  console.log('after player fires:', JSON.stringify(final));
  await page.screenshot({ path: '/tmp/playtest-duel.jpg', type: 'jpeg', quality: 80 });
} else if (mode === 'flow') {
  // Full round flow in fast-forward: buy -> live -> plant -> detonation -> round 2.
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__gameReady === true, null, { timeout: 20000 });
  await page.click('#play');
  await page.waitForTimeout(1000);
  const log = [];
  const snap = async (label) => {
    const s = await page.evaluate(() => {
      const g = window.__game;
      return { phase: g.rounds.state.phase, round: g.rounds.state.round, score: g.rounds.state.score, fuse: g.rounds.state.fuseT.toFixed(1), charge: g.state.charge.mode, cash: g.playerFighter.cash, alive: g.fighters.filter((f) => f.alive).length };
    });
    log.push(`${label}: ${JSON.stringify(s)}`);
  };
  await snap('start');
  // Buy a frag grenade while the menu is open, then skip the buy timer.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.buy-item')].find((b) => b.dataset.id === 'frag');
    if (btn) btn.click();
  });
  await page.evaluate(() => { window.__game.rounds.state.phaseT = 0.3; });
  await page.waitForFunction(() => window.__game.rounds.state.phase === 'live', null, { timeout: 60000 });
  await page.keyboard.press('KeyB');
  // Stage the plant: player at Site A, defenders pulled to Site B so the hold-E
  // plant itself (not the firefight) is what the test measures.
  await page.evaluate(() => {
    const g = window.__game;
    g.playerFighter.pos.set(-15, 0, -11);
    for (const f of g.fighters) {
      if (f.isPlayer || f.team !== 'night') continue;
      f.pos.set(15, 0, -11);
      f.mode = 'hold';
      f.anchor = [15, -11];
      f.route = [];
    }
  });
  await page.keyboard.down('KeyE');
  let planted = false;
  for (let i = 0; i < 12; i += 1) {
    const probe = await page.evaluate(() => {
      const g = window.__game;
      return { phase: g.rounds.state.phase, hp: Math.round(g.playerFighter.hp), alive: g.playerFighter.alive, plantHold: g.state.plantHold.toFixed(2), sim: g.state.time.toFixed(1) };
    });
    log.push(`plant probe ${i}: ${JSON.stringify(probe)}`);
    if (probe.phase === 'planted') { planted = true; break; }
    await page.waitForTimeout(5000);
  }
  await page.keyboard.up('KeyE');
  if (!planted) { console.log(log.join('\n')); throw new Error('plant did not complete'); }
  await snap('planted');
  // Throw a smoke grenade while the fuse runs, then fast-forward the fuse.
  await page.keyboard.press('Digit3');
  await page.keyboard.press('KeyG');
  await page.waitForTimeout(1500);
  const smoke = await page.evaluate(() => window.__game.state.grenades.length);
  log.push(`grenades in flight after G: ${smoke}`);
  await page.evaluate(() => { window.__game.rounds.state.fuseT = 0.5; });
  await page.waitForFunction(() => window.__game.rounds.state.phase === 'over', null, { timeout: 60000 });
  await snap('detonated->over');
  await page.evaluate(() => { window.__game.rounds.state.phaseT = 0.3; });
  await page.waitForFunction(() => window.__game.rounds.state.round === 2, null, { timeout: 60000 });
  await snap('round 2');
  console.log(log.join('\n'));
} else if (mode === 'play') {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__gameReady === true, null, { timeout: 20000 });
  await page.waitForTimeout(1000);
  console.log('loaded, overlay visible:', await page.isVisible('#overlay'));
  await page.click('#play');
  await page.waitForTimeout(1500);
  const s1 = await page.evaluate(() => {
    const g = window.__game;
    return { phase: g.rounds.state.phase, started: g.state.started, buyOpen: g.state.buyOpen, score: g.rounds.state.score };
  });
  console.log('after play click:', JSON.stringify(s1));
  // Buy a frag grenade ($300, affordable on $800) in the open buy menu, then close it.
  const bought = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.buy-item')].find((b) => b.dataset.id === 'frag');
    if (!btn) return 'no frag button';
    btn.click();
    const g = window.__game;
    return `clicked frag; cash=${g.playerFighter.cash} nades=${JSON.stringify(g.playerFighter ? document.querySelector('#nades').textContent : '')}`;
  });
  console.log('buy frag:', bought);
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyB');
  await page.waitForTimeout(500);
  // Wait for the live phase (headless rendering is slow, so poll generously).
  for (let i = 0; i < 14; i += 1) {
    const probe = await page.evaluate(() => {
      const g = window.__game;
      return { phase: g.rounds.state.phase, t: g.rounds.state.phaseT.toFixed(1), sim: g.state.time.toFixed(1) };
    });
    console.log('probe', i, JSON.stringify(probe));
    if (probe.phase === 'live') break;
    await page.waitForTimeout(5000);
  }
  const yaw0 = await page.evaluate(() => window.__game.playerFighter.pos && window.__game.state ? document.querySelector('canvas') && window.__game.rounds.state.phase : '');
  // Move forward and look around, then hold fire at the plaza.
  await page.keyboard.down('KeyW');
  await page.mouse.move(640, 360);
  await page.mouse.move(760, 340, { steps: 8 });
  await page.waitForTimeout(3000);
  await page.keyboard.up('KeyW');
  const moved = await page.evaluate(() => {
    const g = window.__game;
    return { playerPos: [g.playerFighter.pos.x.toFixed(1), g.playerFighter.pos.z.toFixed(1)], yaw: g.state ? 'n/a' : '' };
  });
  console.log('after moving:', JSON.stringify(moved));
  await page.mouse.down();
  await page.waitForTimeout(1500);
  await page.mouse.up();
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(3000);
  const s2 = await page.evaluate(() => {
    const g = window.__game;
    const p = g.playerFighter;
    return {
      phase: g.rounds.state.phase, timer: g.rounds.state.phaseT.toFixed(1),
      playerPos: [p.pos.x.toFixed(1), p.pos.z.toFixed(1)], hp: Math.round(p.hp), cash: p.cash,
      botsAlive: g.fighters.filter((f) => f.alive).length,
      botPos: g.fighters.filter((f) => !f.isPlayer).map((f) => [f.name, f.pos.x.toFixed(1), f.pos.z.toFixed(1), f.alive, Math.round(f.hp)]),
      kills: g.fighters.map((f) => [f.name, f.stats.k, f.stats.d]),
      feed: document.querySelectorAll('#killfeed .feed-item').length,
      radio: document.querySelectorAll('#radio .radio-item').length,
    };
  });
  console.log('after playing:', JSON.stringify(s2, null, 1));
  await page.screenshot({ path: '/tmp/playtest-live.jpg', type: 'jpeg', quality: 80 });
  console.log('live screenshot -> /tmp/playtest-live.jpg');
}

console.log('ERRORS:', errors.length ? errors : 'none');
await browser.close();
server.kill();
process.exit(errors.length ? 1 : 0);
