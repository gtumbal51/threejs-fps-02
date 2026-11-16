// Sound without assets: every effect is synthesised with WebAudio — filtered noise for
// gunshots, short oscillator blips for UI, beeps and the round sting. Nothing is loaded
// over the network and nothing is decoded. The context starts on the first user gesture.
export function createAudio() {
  let ctx = null;
  let noiseBuf = null;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext ?? window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  }

  function noise(dur, freq, gain, type = 'lowpass') {
    const c = ensure();
    if (!c) return;
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    src.connect(filter).connect(g).connect(c.destination);
    src.start();
    src.stop(c.currentTime + dur);
  }

  function tone(freq, dur, gain, type = 'sine', slide = 0) {
    const c = ensure();
    if (!c) return;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, c.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), c.currentTime + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + dur);
  }

  return {
    unlock() {
      ensure();
    },
    shot(id, dist = 0) {
      const vol = Math.max(0.04, 0.5 - dist * 0.012);
      if (id === 'sniper') noise(0.32, 900, vol);
      else if (id === 'shotgun') noise(0.3, 700, vol);
      else if (id === 'smg') noise(0.09, 1600, vol * 0.8);
      else if (id === 'pistol') noise(0.12, 1200, vol);
      else noise(0.14, 1100, vol);
      tone(180, 0.08, vol * 0.4, 'sawtooth', -120);
    },
    dryClick() {
      tone(1400, 0.04, 0.12, 'square');
    },
    reload() {
      tone(500, 0.05, 0.1, 'square');
      setTimeout(() => tone(700, 0.05, 0.1, 'square'), 160);
    },
    hit(head) {
      tone(head ? 1500 : 1000, 0.06, 0.14, 'triangle');
    },
    hurt() {
      noise(0.18, 300, 0.3);
      tone(110, 0.18, 0.2, 'sawtooth', -40);
    },
    plantBeep() {
      tone(880, 0.07, 0.12, 'sine');
    },
    defuseBeep() {
      tone(660, 0.07, 0.12, 'sine');
    },
    explosion() {
      noise(0.7, 220, 0.6);
      tone(60, 0.6, 0.4, 'sine', -20);
    },
    grenadePop() {
      noise(0.25, 500, 0.4);
    },
    roundWin() {
      tone(523, 0.16, 0.14);
      setTimeout(() => tone(659, 0.16, 0.14), 140);
      setTimeout(() => tone(784, 0.3, 0.16), 280);
    },
    roundLose() {
      tone(392, 0.2, 0.13);
      setTimeout(() => tone(311, 0.34, 0.13), 180);
    },
    buy() {
      tone(980, 0.07, 0.1, 'triangle');
      setTimeout(() => tone(1240, 0.09, 0.1, 'triangle'), 70);
    },
    click() {
      tone(800, 0.04, 0.08, 'triangle');
    },
  };
}
