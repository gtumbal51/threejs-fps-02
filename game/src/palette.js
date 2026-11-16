// Lentera Night Market: one palette, one accent. Night indigo for the sky and floor,
// warm lantern amber for light and the Embers, teal for awnings and the Nightwatch,
// coral for signage. Every colour in the game is one of these seven.
export const PALETTE = {
  night: '#0d1420',
  floor: '#1a2230',
  wall: '#232c3d',
  wood: '#6b4a2f',
  awning: '#1f7a6d',
  lantern: '#ffb347',
  coral: '#e4572e',
  ink: '#f2ead8',
  muted: '#8b98a8',
  ember: '#ffb347',
  watch: '#3ec6b8',
};

export function hex(name) {
  return PALETTE[name];
}
