/**
 * Socket wiring. Translates socket events into session.js calls and session.js
 * results into emits. Holds NO game rules.
 *
 * Every client in a session joins the Socket.IO room named after the session
 * id, so io.to(session.id).emit(...) reaches exactly that session. After any
 * state change we pushState so no client renders from a stale snapshot.
 */

const EVENTS = require('./events');
const validate = require('./validate');
const session = require('./session');
const store = require('./store');

// ---------------------------------------------------------------------------
// Emit helpers
// ---------------------------------------------------------------------------

function pushState(io, s) {
  io.to(s.id).emit(EVENTS.SESSION_STATE, session.toPublicState(s));
}

function fail(socket, result) {
  socket.emit(EVENTS.SESSION_ERROR, { code: result.code, message: result.message });
}

function say(io, s, kind, from, text) {
  const entry = { kind, from, text, at: Date.now() };
  s.chat.push(entry);
  if (s.chat.length > 200) {
    s.chat = s.chat.slice(-200);
  }
  io.to(s.id).emit(EVENTS.CHAT_MESSAGE, entry);
}

/** The one place a round-ended broadcast is built, reused by three callers. */
function emitEnded(io, s, result) {
  io.to(s.id).emit(EVENTS.GAME_ENDED, {
    reason: result.reason,
    answer: result.answer,
    winner: result.winner
      ? { id: result.winner.id, name: result.winner.name, score: result.winner.score }
      : null,
    scores: [...s.players.values()].map((p) => ({ id: p.id, name: p.name, score: p.score }))
  });
}

function announceMaster(io, s) {
  const master = s.players.get(s.masterId);
  if (master) {
    say(io, s, 'system', 'system', `${master.name} is now the game master.`);
  }
}

// ---------------------------------------------------------------------------
// Round timer - R9, the authoritative 60-second clock, server-side.
// ---------------------------------------------------------------------------

function armTimer(io, s) {
  session.clearRoundTimer(s);

  s.round.timerId = setInterval(() => {
    // The round may have ended via a correct guess between ticks.
    if (!s.round) {
      clearInterval(s.round ? s.round.timerId : undefined);
      return;
    }

    const secondsLeft = Math.max(0, Math.ceil((s.round.endsAt - Date.now()) / 1000));
    io.to(s.id).emit(EVENTS.TIMER_TICK, { secondsLeft });

    if (secondsLeft <= 0) {
      // Guard against a double-end: a winner this tick means the guess path
      // already tore the round down.
      if (!s.round || s.round.winnerId) {
        return;
      }
      const result = session.endRound(s, session.END_REASON.TIMEOUT);
      emitEnded(io, s, result);
      say(io, s, 'result', 'system', `Time is up. The answer was "${result.answer}". No winner this round.`);
      announceMaster(io, s);
      pushState(io, s);
    }
  }, 1000);
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

function registerHandlers(io, socket) {
  socket.on(EVENTS.CREATE_SESSION, (payload) => {
    const v = validate.validateName(payload && payload.name);
    if (!v.ok) return fail(socket, v);

    const r = session.create(socket.id, v.value);
    if (!r.ok) return fail(socket, r);

    socket.join(r.session.id);
    say(io, r.session, 'system', 'system', `${v.value} created the session and is the game master.`);
    pushState(io, r.session);
  });

  socket.on(EVENTS.JOIN_SESSION, (payload) => {
    const vid = validate.validateSessionId(payload && payload.sessionId);
    if (!vid.ok) return fail(socket, vid);

    const vn = validate.validateName(payload && payload.name);
    if (!vn.ok) return fail(socket, vn);

    const r = session.join(vid.value, socket.id, vn.value);
    if (!r.ok) return fail(socket, r);

    socket.join(r.session.id);
    // Replay the chat so far to this joiner alone.
    r.session.chat.forEach((m) => socket.emit(EVENTS.CHAT_MESSAGE, m));
    say(io, r.session, 'system', 'system', `${vn.value} joined. ${r.session.players.size} players connected.`);
    pushState(io, r.session);
  });

  socket.on(EVENTS.SET_QUESTION, (payload) => {
    const v = validate.validateQuestion(payload && payload.question, payload && payload.answer);
    if (!v.ok) return fail(socket, v);

    const r = session.setQuestion(socket.id, v.value.question, v.value.answer);
    if (!r.ok) return fail(socket, r);

    say(io, r.session, 'system', 'system', 'The game master has set a question.');
    pushState(io, r.session);
  });

  socket.on(EVENTS.START_GAME, () => {
    const r = session.startGame(socket.id);
    if (!r.ok) return fail(socket, r);

    io.to(r.session.id).emit(EVENTS.GAME_STARTED, {
      question: r.session.question,
      endsAt: r.session.round.endsAt,
      attemptsAllowed: session.RULES.ATTEMPTS_PER_PLAYER
    });
    armTimer(io, r.session);
    say(io, r.session, 'system', 'system',
      `Game started. ${session.RULES.ROUND_SECONDS} seconds, ${session.RULES.ATTEMPTS_PER_PLAYER} attempts each.`);
    pushState(io, r.session);
  });

  socket.on(EVENTS.SUBMIT_GUESS, (payload) => {
    const v = validate.validateGuess(payload && payload.guess);
    if (!v.ok) return fail(socket, v);

    const r = session.submitGuess(socket.id, v.value);
    if (!r.ok) return fail(socket, r);

    socket.emit(EVENTS.GUESS_RESULT, {
      correct: r.correct,
      attemptsLeft: r.attemptsLeft,
      locked: r.locked
    });

    const player = r.session.players.get(socket.id);
    const name = player ? player.name : 'Someone';

    if (!r.correct) {
      say(io, r.session, 'chat', name, `guessed "${v.value}"`);
      pushState(io, r.session);
      return;
    }

    // Correct. Tear the round down through the single exit and announce.
    const ended = session.endRound(r.session, session.END_REASON.CORRECT);
    emitEnded(io, r.session, ended);
    say(io, r.session, 'result', 'system',
      `${name} got it. The answer was "${ended.answer}". +${session.RULES.WIN_POINTS} points.`);
    announceMaster(io, r.session);
    pushState(io, r.session);
  });

  socket.on(EVENTS.SEND_CHAT, (payload) => {
    const v = validate.validateChat(payload && payload.text);
    if (!v.ok) return fail(socket, v);

    const s = store.findBySocket(socket.id);
    if (!s) return fail(socket, { code: 'NOT_IN_SESSION', message: 'You are not in a session.' });

    const player = s.players.get(socket.id);
    const name = player ? player.name : 'Someone';
    say(io, s, 'chat', name, v.value);
  });

  function handleDeparture() {
    const r = session.leave(socket.id);
    if (!r.ok) return;

    if (r.deleted) {
      console.log('[session] removed (empty)');
      return;
    }

    say(io, r.session, 'system', 'system', `${r.name} left. ${r.session.players.size} players connected.`);
    if (r.newMasterId) announceMaster(io, r.session);
    if (r.roundEnded) {
      emitEnded(io, r.session, r.roundEnded);
      say(io, r.session, 'result', 'system',
        `Round ended - not enough players. The answer was "${r.roundEnded.answer}".`);
    }
    pushState(io, r.session);
  }

  socket.on(EVENTS.LEAVE_SESSION, handleDeparture);
  socket.on('disconnect', handleDeparture);
}

module.exports = registerHandlers;
module.exports.pushState = pushState;
module.exports.armTimer = armTimer;
