// All tuning numbers in one place: weapons, economy, rounds, teams, bot rosters and
// round plans. No other module hard-codes a price, a damage number or a bot name.
export const MATCH = {
  ROUNDS_MAX: 12,
  WIN_ROUNDS: 7,
  ROUND_SECONDS: 90,
  BUY_SECONDS: 12,
  FUSE_SECONDS: 40,
  PLANT_SECONDS: 3.5,
  DEFUSE_SECONDS: 7,
  DEFUSE_KIT_SECONDS: 3.6,
  HALF_ROUND: 6,
  START_CASH: 800,
};

export const ECONOMY = {
  WIN: 3000,
  LOSS: 1400,
  KILL: 300,
  PLANT: 400,
  DEFUSE: 400,
};

// damage = base; headshots multiply by HEAD_MULT; beyond FALLOFF_M damage scales by FALLOFF_MULT.
export const WEAPONS = {
  pistol: { id: 'pistol', slot: 2, name: 'Kancil P9', cat: 'Pistols', price: 300, flavor: 'Reliable sidearm. Quiet, quick, honest.', damage: 34, headMult: 2.5, rpm: 320, mag: 12, reserve: 48, reload: 1.5, spreadStill: 0.003, spreadMove: 0.024, auto: false, range: 28, falloff: 0.8, tracer: 0xffd9a0 },
  smg: { id: 'smg', slot: 1, name: 'Sriti-9', cat: 'SMGs', price: 1250, flavor: 'Buzzsaw for close lanes. Hungry for ammo.', damage: 26, headMult: 2.5, rpm: 750, mag: 28, reserve: 112, reload: 2.0, spreadStill: 0.006, spreadMove: 0.03, auto: true, range: 24, falloff: 0.7, tracer: 0xffe08a },
  shotgun: { id: 'shotgun', slot: 1, name: 'Gedebog-12', cat: 'Shotguns', price: 1500, flavor: 'Eight pellets of bad news at arm’s length.', damage: 13, headMult: 2, rpm: 68, mag: 6, reserve: 24, reload: 2.6, spreadStill: 0.02, spreadMove: 0.045, auto: false, pellets: 8, range: 16, falloff: 0.5, tracer: 0xffc46b },
  rifle: { id: 'rifle', slot: 1, name: 'Bambu AR-77', cat: 'Rifles', price: 2700, flavor: 'The market’s workhorse. Tap, don’t spray.', damage: 34, headMult: 2.5, rpm: 600, mag: 30, reserve: 90, reload: 2.1, spreadStill: 0.0022, spreadMove: 0.028, auto: true, range: 60, falloff: 0.85, tracer: 0xffe9b0 },
  sniper: { id: 'sniper', slot: 1, name: 'Elang LR-50', cat: 'Rifles', price: 4750, flavor: 'One breath, one lantern, one shot.', damage: 95, headMult: 2.5, rpm: 48, mag: 5, reserve: 15, reload: 3.0, spreadStill: 0.0008, spreadMove: 0.05, auto: false, range: 80, falloff: 0.95, tracer: 0xfff2cc },
};

export const GEAR = {
  vest: { id: 'vest', name: 'Padded Vest', cat: 'Gear', price: 650, flavor: 'Soaks body shots. Your ribs say thanks.' },
  vesthelm: { id: 'vesthelm', name: 'Vest + Helm', cat: 'Gear', price: 1000, flavor: 'Vest and a steel helm. Headshots hurt less.' },
  kit: { id: 'kit', name: 'Defuse Kit', cat: 'Gear', price: 400, flavor: 'Defuse in 3.6 s instead of 7. Defenders only.' },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'Petasan Frag', cat: 'Grenades', price: 300, flavor: 'Loud cracker. 120 damage in a 6 m burst.', fuse: 1.6, radius: 6, damage: 120 },
  smoke: { id: 'smoke', name: 'Asap Smoke', cat: 'Grenades', price: 300, flavor: 'Thick incense smoke. Blocks sight for 14 s.', fuse: 1.4, radius: 5, duration: 14 },
  flash: { id: 'flash', name: 'Kilau Flash', cat: 'Grenades', price: 200, flavor: 'Lantern pop. Blinds anyone facing it.', fuse: 1.5, radius: 22 },
  fire: { id: 'fire', name: 'Bara Fire', cat: 'Grenades', price: 400, flavor: 'Burning oil. Denies a lane for 8 s.', fuse: 1.4, radius: 4, duration: 8, dps: 35 },
};

export const TEAMS = {
  embers: { id: 'embers', name: 'Embers', color: 0xffb347, css: '#ffb347', job: 'attack' },
  night: { id: 'night', name: 'Nightwatch', color: 0x3ec6b8, css: '#3ec6b8', job: 'defend' },
};

// Four friendly bots + the player make the Embers; five bots make the Nightwatch.
export const ROSTER = {
  embers: [
    { name: 'Rani', role: 'Entry', weapon: 'rifle' },
    { name: 'Bimo', role: 'Support', weapon: 'smg' },
    { name: 'Sari', role: 'Anchor', weapon: 'rifle' },
    { name: 'Dedi', role: 'Lurk', weapon: 'shotgun' },
  ],
  night: [
    { name: 'Agus', role: 'AWPer', weapon: 'sniper' },
    { name: 'Maya', role: 'Anchor', weapon: 'rifle' },
    { name: 'Joko', role: 'Entry', weapon: 'rifle' },
    { name: 'Lestari', role: 'Support', weapon: 'smg' },
    { name: 'Rizky', role: 'Lurk', weapon: 'smg' },
  ],
};

export const PLANS = [
  { name: 'SPLIT A', site: 'A', desc: 'Three push Long A, two swing Mid' },
  { name: 'RUSH B', site: 'B', desc: 'All five through Short B, fast' },
  { name: 'MID CONTROL', site: 'A', desc: 'Take Mid, then split to A' },
  { name: 'SLOW A', site: 'A', desc: 'Quiet walk to A, no noise till contact' },
  { name: 'FAKE B', site: 'A', desc: 'Noise at B, real push at A' },
];

export const CALLOUTS = {
  mid: 'Mid', longa: 'Long A', shortb: 'Short B', siteA: 'Site A', siteB: 'Site B',
  spawnA: 'Attacker Spawn', spawnD: 'Defender Spawn', plaza: 'Lantern Plaza', alley: 'Spice Alley',
};

export function calloutAt(x, z) {
  if (z < -8) return x < -6 ? 'siteA' : x > 6 ? 'siteB' : 'plaza';
  if (z > 10) return 'spawnA';
  if (Math.abs(x) < 3) return 'mid';
  return x < 0 ? 'longa' : 'shortb';
}
