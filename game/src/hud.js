// The DOM HUD: every panel the player reads, and nothing else. It never touches the
// simulation; main.js pushes numbers and events in, and the buy menu calls back out.
// Cached element handles and last-value guards keep DOM writes out of hot loops.
import { WEAPONS, GEAR, GRENADES, ECONOMY, TEAMS } from './config.js';

export function createHud(callbacks) {
  const $ = (id) => document.getElementById(id);
  const els = {
    scorebar: $('scorebar'), timer: $('timer'), roundLabel: $('round-label'), phaseLabel: $('phase-label'),
    scoreEmbers: $('score-embers'), scoreNight: $('score-night'),
    pipsEmbers: $('pips-embers'), pipsNight: $('pips-night'),
    minimap: $('minimap'), location: $('location'),
    feed: $('killfeed'), radio: $('radio'),
    health: $('health'), armour: $('armour'), cash: $('cash'), hint: $('hint'),
    weaponName: $('weapon-name'), fireMode: $('fire-mode'), mag: $('mag'), reserve: $('reserve'),
    slots: $('slots'), nades: $('nades'), spread: $('spread'),
    crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    progress: $('progress'), progressLabel: $('progress-label'), progressFill: $('progress-fill'),
    buy: $('buy'), buyGrid: $('buy-grid'), buyCash: $('buy-cash'), buyClose: $('buy-close'),
    board: $('board'), boardRows: $('board-rows'), boardTitle: $('board-title'),
    overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'),
    play: $('play'), flash: $('flash'), damage: $('damage'),
    charge: $('charge'), chargeLabel: $('charge-label'),
  };
  const mapCtx = els.minimap.getContext('2d');
  let mapData = null;
  let last = {};
  let hitTimer = 0;
  let bannerTimer = 0;
  let flashTimer = 0;

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  function pips(el, key, alive, total) {
    const value = `${alive}/${total}`;
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = '●'.repeat(alive) + '○'.repeat(Math.max(0, total - alive));
  }

  function feedItem(html) {
    const div = document.createElement('div');
    div.className = 'feed-item';
    div.innerHTML = html;
    els.feed.prepend(div);
    while (els.feed.children.length > 5) els.feed.removeChild(els.feed.lastChild);
    setTimeout(() => { div.classList.add('fade'); }, 4200);
    setTimeout(() => { div.remove(); }, 5000);
  }

  function radioItem(text) {
    const div = document.createElement('div');
    div.className = 'radio-item';
    div.textContent = text;
    els.radio.prepend(div);
    while (els.radio.children.length > 4) els.radio.removeChild(els.radio.lastChild);
    setTimeout(() => { div.remove(); }, 6000);
  }

  function buildBuy() {
    const cats = {};
    for (const w of Object.values(WEAPONS)) (cats[w.cat] ??= []).push({ kind: 'weapon', ...w });
    for (const g of Object.values(GEAR)) (cats[g.cat] ??= []).push({ kind: 'gear', ...g });
    for (const g of Object.values(GRENADES)) (cats[g.cat] ??= []).push({ kind: 'grenade', ...g });
    for (const [cat, items] of Object.entries(cats)) {
      const box = document.createElement('div');
      box.className = 'buy-cat';
      const h = document.createElement('h3');
      h.textContent = cat;
      box.appendChild(h);
      for (const item of items) {
        const b = document.createElement('button');
        b.className = 'buy-item';
        b.dataset.id = item.id;
        b.dataset.kind = item.kind;
        const stats = item.rpm ? `${item.damage} DMG · ${item.rpm} RPM · ${item.mag} MAG` : item.damage ? `${item.damage} DMG` : '';
        b.innerHTML = `<span class="buy-name">${item.name}</span><span class="buy-stats">${stats}${stats ? ' · ' : ''}${item.flavor}</span><span class="buy-price">$${item.price}</span><span class="buy-state"></span>`;
        b.addEventListener('click', () => callbacks.onBuy(item.kind, item.id));
        box.appendChild(b);
      }
      els.buyGrid.appendChild(box);
    }
    const foot = document.createElement('div');
    foot.className = 'buy-foot';
    foot.innerHTML = `Round payout — Win $${ECONOMY.WIN} · Loss $${ECONOMY.LOSS} · Kill $${ECONOMY.KILL} · Plant $${ECONOMY.PLANT}<br>Buy with the mouse or press <b>B</b> to close. Weapons persist between rounds; grenades and gear are bought fresh.`;
    els.buyGrid.appendChild(foot);
    els.buyClose.addEventListener('click', () => callbacks.onCloseBuy());
  }
  buildBuy();

  function refreshBuy(cash, owned) {
    setText(els.buyCash, 'buyCash', `CASH $${cash}`);
    for (const b of els.buyGrid.querySelectorAll('.buy-item')) {
      const id = b.dataset.id;
      const kind = b.dataset.kind;
      const price = kind === 'weapon' ? WEAPONS[id].price : kind === 'gear' ? GEAR[id].price : GRENADES[id].price;
      const stateEl = b.querySelector('.buy-state');
      let state = '';
      let cls = '';
      if (kind === 'weapon' && owned.weapons.includes(id)) { state = 'OWNED'; cls = 'owned'; }
      else if (kind === 'gear' && owned.gear.includes(id)) { state = 'OWNED'; cls = 'owned'; }
      else if (kind === 'grenade' && (owned.grenades[id] ?? 0) > 0) { state = `OWNED ×${owned.grenades[id]}`; cls = 'owned'; }
      else if (cash < price) { state = 'TOO EXPENSIVE'; cls = 'poor'; }
      if (stateEl.textContent !== state) stateEl.textContent = state;
      b.className = `buy-item ${cls}`;
    }
  }

  function drawMinimap(fighters, charge, sites, playerTeam) {
    if (!mapData) return;
    const c = mapCtx;
    const W = els.minimap.width;
    const H = els.minimap.height;
    const sx = W / 46;
    const sy = H / 38;
    const px = (x) => (x + 23) * sx;
    const py = (z) => (z + 19) * sy;
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#0d1420';
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#2c3547';
    for (const [x, z, w, d] of mapData.rects) c.fillRect(px(x), py(z), w * sx, d * sy);
    c.font = 'bold 13px system-ui, sans-serif';
    c.textAlign = 'center';
    for (const [name, s] of Object.entries(sites)) {
      c.fillStyle = name === 'A' ? '#e4572e' : '#1f7a6d';
      c.beginPath();
      c.arc(px(s.x), py(s.z), 7, 0, 6.29);
      c.fill();
      c.fillStyle = '#f2ead8';
      c.fillText(name, px(s.x), py(s.z) + 4.5);
    }
    for (const f of fighters) {
      if (!f.alive) continue;
      c.fillStyle = f.isPlayer ? '#ffffff' : f.team === playerTeam ? '#ffb347' : '#3ec6b8';
      c.beginPath();
      c.arc(px(f.pos.x), py(f.pos.z), f.isPlayer ? 4 : 3, 0, 6.29);
      c.fill();
      if (f.isPlayer) {
        c.strokeStyle = '#ffffff';
        c.beginPath();
        c.moveTo(px(f.pos.x), py(f.pos.z));
        c.lineTo(px(f.pos.x) - Math.sin(f.yaw) * 9, py(f.pos.z) - Math.cos(f.yaw) * 9);
        c.stroke();
      }
    }
    if (charge && charge.state === 'planted') {
      c.fillStyle = '#ff5a3c';
      c.beginPath();
      c.arc(px(charge.x), py(charge.z), 5, 0, 6.29);
      c.fill();
    }
  }

  return {
    setMap(world) {
      mapData = { rects: world.minimapRects };
    },
    setScore(embers, night) {
      setText(els.scoreEmbers, 'se', String(embers));
      setText(els.scoreNight, 'sn', String(night));
    },
    setRound(round, max) {
      setText(els.roundLabel, 'rl', `ROUND ${round} OF ${max}`);
    },
    setTimer(text) {
      setText(els.timer, 'tm', text);
    },
    setPhase(text) {
      setText(els.phaseLabel, 'ph', text);
    },
    setPips(aliveEmbers, aliveNight) {
      pips(els.pipsEmbers, 'pe', aliveEmbers, 5);
      pips(els.pipsNight, 'pn', aliveNight, 5);
    },
    setHealth(hp, armour, helmet) {
      setText(els.health, 'hp', String(Math.max(0, Math.ceil(hp))));
      setText(els.armour, 'ar', `${armour}${helmet ? ' +HELM' : ''}`);
      els.health.classList.toggle('low', hp <= 30);
    },
    setCash(cash) {
      setText(els.cash, 'ca', `$${cash}`);
    },
    setHint(text) {
      setText(els.hint, 'hi', text);
    },
    setWeapon(name, mode, mag, reserve) {
      setText(els.weaponName, 'wn', name);
      setText(els.fireMode, 'fm', mode);
      setText(els.mag, 'mg', String(mag));
      setText(els.reserve, 'rv', `/ ${reserve}`);
      els.mag.parentElement.classList.toggle('empty', mag === 0);
    },
    setSlots(slot, grenades) {
      const html = ['1', '2', '3'].map((n) => `<span class="${Number(n) === slot ? 'on' : ''}">${n}</span>`).join('');
      if (last.slots !== html) { last.slots = html; els.slots.innerHTML = html; }
      const g = Object.entries(grenades).filter(([, n]) => n > 0).map(([id, n]) => `${GRENADES[id].name.split(' ')[1]} ×${n}`).join(' · ');
      setText(els.nades, 'nd', g || 'NO GRENADES');
    },
    setSpread(text) {
      setText(els.spread, 'sp', text);
      const value = Number(text.split(' ').pop());
      const gap = Number.isFinite(value) ? Math.min(26, 4 + value * 400) : 8;
      els.crosshair.style.setProperty('--gap', `${gap}px`);
    },
    setLocation(text) {
      setText(els.location, 'lc', text);
    },
    setCharge(text) {
      if (!text) { els.charge.hidden = true; return; }
      els.charge.hidden = false;
      setText(els.chargeLabel, 'ch', text);
    },
    killFeed(killer, victim, head, weaponName) {
      feedItem(`<b style="color:${killer.team === 'embers' ? '#ffb347' : '#3ec6b8'}">${killer.name}</b> ${head ? '<span class="hs">HEADSHOT</span> ' : ''}<span class="w">${weaponName}</span> <b style="color:${victim.team === 'embers' ? '#ffb347' : '#3ec6b8'}">${victim.name}</b>`);
    },
    radio(text) {
      radioItem(text);
    },
    banner(title, sub, holdMs = 2600) {
      els.bannerTitle.textContent = title;
      els.bannerSub.textContent = sub ?? '';
      els.banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { els.banner.hidden = true; }, holdMs);
    },
    hideBanner() {
      els.banner.hidden = true;
    },
    showProgress(label, frac) {
      els.progress.hidden = false;
      setText(els.progressLabel, 'pl', label);
      els.progressFill.style.width = `${Math.round(frac * 100)}%`;
    },
    hideProgress() {
      els.progress.hidden = true;
    },
    hitMarker(killed) {
      els.hitmarker.classList.add('on');
      els.hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => els.hitmarker.classList.remove('on', 'kill'), 110);
    },
    flashBomb() {
      els.flash.classList.add('on');
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => els.flash.classList.remove('on'), 900);
    },
    damageFlash() {
      els.damage.classList.add('on');
      setTimeout(() => els.damage.classList.remove('on'), 220);
    },
    showBuy(cash, owned) {
      refreshBuy(cash, owned);
      els.buy.hidden = false;
    },
    hideBuy() {
      els.buy.hidden = true;
    },
    refreshBuy,
    showScoreboard(rows, title) {
      els.boardTitle.textContent = title;
      els.boardRows.innerHTML = rows.map((r) => `<tr class="${r.isPlayer ? 'me' : ''}"><td>${r.name}</td><td>${r.team}</td><td>${r.k}</td><td>${r.a}</td><td>${r.d}</td><td>${r.hs}</td><td>${r.dmg}</td><td>$${r.cash}</td></tr>`).join('');
      els.board.hidden = false;
    },
    hideScoreboard() {
      els.board.hidden = true;
    },
    showOverlay(mode, data) {
      const copy = {
        start: ['LENTERA', 'Night Market Strike — 5v5, 12 rounds, first to 7. Plant the charge or wipe the other team.', 'Click to play'],
        paused: ['LENTERA', 'Paused. Click to resume.', 'Click to resume'],
        end: [data?.winner === 'embers' ? 'EMBERS WIN THE MARKET' : 'NIGHTWATCH HOLDS THE MARKET', `Final score ${data?.embers ?? 0} – ${data?.night ?? 0}.`, 'Play again'],
      }[mode];
      els.overlayTitle.textContent = copy[0];
      els.overlayCopy.textContent = copy[1];
      els.play.textContent = copy[2];
      els.overlay.hidden = false;
      els.play.focus();
    },
    hideOverlay() {
      els.overlay.hidden = true;
    },
    onPlay(handler) {
      els.play.addEventListener('click', handler);
    },
    drawMinimap,
  };
}
