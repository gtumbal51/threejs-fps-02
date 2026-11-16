// The match: 12 rounds, first to 7, sides swap after round 6. One state machine owns the
// phase (buy, live, planted, over, match), the timers, the scores, the per-round plan
// and the economy payouts. It never touches the renderer or the DOM; main.js reads its
// state and acts on the events it returns.
import { MATCH, ECONOMY, PLANS } from './config.js';

export function createRounds() {
  const state = {
    phase: 'menu',
    phaseT: 0,
    round: 0,
    score: { embers: 0, night: 0 },
    plan: PLANS[0],
    targetSite: 'A',
    fuseT: 0,
    matchOver: false,
    winner: null,
    reason: '',
    plantSite: null,
    halfSwapped: false,
  };

  function attackerTeam() {
    // Embers attack rounds 1-6, Nightwatch attack rounds 7-12.
    return state.round <= MATCH.HALF_ROUND ? 'embers' : 'night';
  }

  function defenderTeam() {
    return attackerTeam() === 'embers' ? 'night' : 'embers';
  }

  function beginMatch() {
    state.phase = 'buy';
    state.phaseT = MATCH.BUY_SECONDS;
    state.round = 1;
    state.score = { embers: 0, night: 0 };
    state.matchOver = false;
    state.winner = null;
    state.reason = '';
    state.halfSwapped = false;
    pickPlan();
    return { type: 'matchStart' };
  }

  function pickPlan() {
    state.plan = PLANS[Math.floor(Math.random() * PLANS.length)];
    state.targetSite = state.plan.site;
  }

  function beginRound() {
    state.phase = 'buy';
    state.phaseT = MATCH.BUY_SECONDS;
    state.plantSite = null;
    pickPlan();
    return { type: 'roundStart', round: state.round };
  }

  function plant(site) {
    state.phase = 'planted';
    state.fuseT = MATCH.FUSE_SECONDS;
    state.plantSite = site;
    return { type: 'planted', site };
  }

  function award(winner, reason) {
    state.score[winner] += 1;
    state.phase = 'over';
    state.phaseT = 4;
    state.reason = reason;
    const events = [{ type: 'roundEnd', winner, reason, round: state.round }];
    if (state.score[winner] >= MATCH.WIN_ROUNDS) {
      state.matchOver = true;
      state.winner = winner;
      state.phase = 'match';
      state.phaseT = 0;
      events.push({ type: 'matchEnd', winner, reason });
    } else if (state.round >= MATCH.ROUNDS_MAX && state.score.embers !== state.score.night) {
      state.matchOver = true;
      state.winner = state.score.embers > state.score.night ? 'embers' : 'night';
      state.phase = 'match';
      state.phaseT = 0;
      events.push({ type: 'matchEnd', winner: state.winner, reason: 'Match score' });
    }
    return events;
  }

  function update(dt, alive) {
    const events = [];
    if (state.phase === 'buy') {
      state.phaseT -= dt;
      if (state.phaseT <= 0) {
        state.phase = 'live';
        state.phaseT = MATCH.ROUND_SECONDS;
        events.push({ type: 'liveStart' });
      }
    } else if (state.phase === 'live') {
      state.phaseT -= dt;
      if (alive.embers === 0 || alive.night === 0) {
        const winner = alive.embers === 0 ? 'night' : 'embers';
        events.push(...award(winner, alive.embers === 0 && alive.night === 0 ? 'Mutual elimination' : 'Team eliminated'));
      } else if (state.phaseT <= 0) {
        events.push(...award(defenderTeam(), 'Time expired — charge never planted'));
      }
    } else if (state.phase === 'planted') {
      state.fuseT -= dt;
      if (alive[attackerTeam()] === 0 && alive[defenderTeam()] > 0) {
        // Attackers all dead after the plant: defenders must still defuse.
      }
      if (state.fuseT <= 0) {
        events.push(...award(attackerTeam(), 'Charge detonated'));
        events.push({ type: 'detonated' });
      }
    } else if (state.phase === 'over') {
      state.phaseT -= dt;
      if (state.phaseT <= 0) {
        if (state.matchOver) {
          state.phase = 'match';
        } else {
          state.round += 1;
          events.push(beginRound());
        }
      }
    }
    return events;
  }

  function defuseDone() {
    return award(defenderTeam(), 'Charge defused');
  }

  function economyFor(team, won) {
    return won ? ECONOMY.WIN : ECONOMY.LOSS;
  }

  return {
    state,
    attackerTeam,
    defenderTeam,
    beginMatch,
    beginRound,
    plant,
    award,
    update,
    defuseDone,
    economyFor,
    timerText() {
      if (state.phase === 'buy') return `BUY ${Math.ceil(state.phaseT)}`;
      if (state.phase === 'live') {
        const t = Math.max(0, state.phaseT);
        return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
      }
      if (state.phase === 'planted') {
        const t = Math.max(0, state.fuseT);
        return `FUSE ${t.toFixed(1)}`;
      }
      return state.phase.toUpperCase();
    },
  };
}
