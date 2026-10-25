/** The game rules. handlers.js does the socket wiring and holds none of them. */

const store = require("./store");

const RULES = {
  ATTEMPTS_PER_PLAYER: 3, // R7
  MIN_PLAYERS_TO_START: 3, // R6  "more than two players" -> 3 or more
  ROUND_SECONDS: 60, // R9
  WIN_POINTS: 10, // R10
};

const STATUS = {
  LOBBY: "lobby",
  IN_PROGRESS: "in_progress",
  ENDED: "ended",
};

const END_REASON = {
  CORRECT: "correct_answer",
  TIMEOUT: "timeout",
  ABANDONED: "abandoned",
};

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

function makePlayer(socketId, name) {
  return {
    id: socketId,
    name,
    score: 0,
    attemptsLeft: 0, // handed out per round in startGame, not at join
    locked: false,
    joinedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/** Requirement 2  Start a game session (the creator becomes master). */
function create(socketId, name) {
  const id = store.generateId();
  const session = {
    id,
    masterId: socketId,
    status: STATUS.LOBBY,
    question: null,
    answer: null,
    players: new Map([[socketId, makePlayer(socketId, name)]]),
    order: [socketId],
    round: null,
    chat: [],
  };
  store.save(session);
  store.indexSocket(socketId, id);
  return { ok: true, session };
}

/** Requirement 3  Join before start. R8  No joining while a round is running. */
function join(sessionId, socketId, name) {
  const session = store.get(sessionId);
  if (!session)
    return {
      ok: false,
      code: "SESSION_NOT_FOUND",
      message: "No session with that code",
    };
  if (session.status === STATUS.IN_PROGRESS)
    return {
      ok: false,
      code: "GAME_IN_PROGRESS",
      message: "That game has already started",
    };
  if (session.players.has(socketId))
    return {
      ok: false,
      code: "ALREADY_JOINED",
      message: "You are already in the session",
    };
  const taken = [...session.players.values()].some(
    (p) => p.name.toLowerCase() === name.toLowerCase(),
  );
  if (taken)
    return {
      ok: false,
      code: "NAME_TAKEN",
      message: "That name is taken in this session.",
    };
  session.players.set(socketId, makePlayer(socketId, name));
  session.order.push(socketId);
  store.indexSocket(socketId, sessionId);
  return { ok: true, session };
}

/** R13  Handover on departure. R14  Delete the session when empty. */
function leave(socketId) {
  const session = store.findBySocket(socketId);
  if (!session) return { ok: false, code: "NOT_IN_SESSION" };
  const player = session.players.get(socketId);
  const name = player ? player.name : "Someone";
  session.players.delete(socketId);
  session.order = session.order.filter((id) => id !== socketId);
  store.unindexSocket(socketId);
  if (session.players.size === 0) {
    clearRoundTimer(session);
    store.remove(session.id);
    return { ok: true, session: null, deleted: true, name };
  }
  let newMasterId = null;
  if (socketId === session.masterId) {
    session.masterId = session.order[0];
    newMasterId = session.masterId;
  }
  let roundEnded = null;
  if (
    session.status === STATUS.IN_PROGRESS &&
    session.players.size < RULES.MIN_PLAYERS_TO_START
  ) {
    roundEnded = endRound(session, END_REASON.ABANDONED);
  }

  return { ok: true, session, name, newMasterId, roundEnded };
}

// ---------------------------------------------------------------------------
// Question and start
// ---------------------------------------------------------------------------

/** R5  Master sets a question and answer. Input already validated. */
function setQuestion(socketId, question, answer) {
  const session = store.findBySocket(socketId);
  if (!session) {
    return {
      ok: false,
      code: "NOT_IN_SESSION",
      message: "You are not in a session.",
    };
  }
  if (socketId !== session.masterId) {
    return {
      ok: false,
      code: "NOT_MASTER",
      message: "Only the game master can set the question.",
    };
  }
  if (session.status === STATUS.IN_PROGRESS) {
    return {
      ok: false,
      code: "GAME_IN_PROGRESS",
      message: "Cannot change the question mid-round.",
    };
  }
  session.question = question;
  session.answer = answer;
  session.status = STATUS.LOBBY;
  return { ok: true, session };
}

/** Requirement 6 :   Master-only start, 3+ players. R7  Hand out 3 attempts each. */
function startGame(socketId) {
  const session = store.findBySocket(socketId);
  if (!session)
    return {
      ok: false,
      code: "NOT_IN_SESSION",
      message: "You are not in session",
    };
  if (socketId !== session.masterId)
    return {
      ok: false,
      code: "NOT_MASTER",
      message: "Only the game master can start.",
    };
  if (session.status === STATUS.IN_PROGRESS)
    return {
      ok: false,
      code: "ALREADY_STARTED",
      message: "The game is already running",
    };
  if (!session.question || !session.answer)
    return { ok: false, code: "NO_QUESTION", message: "Set a question first" };
  if (session.players.size < RULES.MIN_PLAYERS_TO_START)
    return {
      ok: false,
      code: "NOT_ENOUGH_PLAYERS",
      message: `Need at least ${RULES.MIN_PLAYERS_TO_START} players. ${session.players.size} connected.`,
    };

  for (const p of session.players.values()) {
    if (p.id === session.masterId) {
      p.attemptsLeft = 0;
      p.locked = true;
    } else {
      p.attemptsLeft = RULES.ATTEMPTS_PER_PLAYER;
      p.locked = false;
    }
  }
  session.status = STATUS.IN_PROGRESS;
  session.round = {
    startedAt: Date.now(),
    endsAt: Date.now() + RULES.ROUND_SECONDS * 1000,
    timerId: null,
    winnerId: null,
  };
  return { ok: true, session };
}

// ---------------------------------------------------------------------------
// Guessing
// ---------------------------------------------------------------------------

/** Case-insensitive, whitespace-tolerant. No fuzzy matching (see README). */
function isCorrect(guess, answer) {
  const norm = (s) => String(s).trim().replace(/\s+/g, " ").toLowerCase();
  return norm(guess) === norm(answer);
}

/** R7  3 attempts. R10  Winner locks others out and scores 10. */
function submitGuess(socketId, guess) {
  const session = store.findBySocket(socketId);
  if (!session)
    return {
      ok: false,
      code: "NOT_IN_SESSION",
      message: "You are not in a session.",
    };
  if (session.status !== STATUS.IN_PROGRESS)
    return {
      ok: false,
      code: "GAME_NOT_RUNNING",
      message: "No round is running.",
    };
  if (session.round.winnerId)
    return {
      ok: false,
      code: "ROUND_OVER",
      message: "Someone already won this round.",
    };

  const player = session.players.get(socketId);
  if (!player)
    return {
      ok: false,
      code: "NOT_IN_SESSION",
      message: "You are not in a session.",
    };
  if (player.locked)
    return {
      ok: false,
      code: "LOCKED_OUT",
      message: "You are out of this round.",
    };
  if (player.attemptsLeft <= 0)
    return {
      ok: false,
      code: "NO_ATTEMPTS_LEFT",
      message: "No attempts left.",
    };

  player.attemptsLeft -= 1;

  if (isCorrect(guess, session.answer)) {
    session.round.winnerId = socketId;
    player.score += RULES.WIN_POINTS;
    session.status = STATUS.ENDED;
    return { ok: true, correct: true, session, endReason: END_REASON.CORRECT };
  }

  if (player.attemptsLeft <= 0) player.locked = true;

  return {
    ok: true,
    correct: false,
    attemptsLeft: player.attemptsLeft,
    locked: player.locked,
    session,
  };
}

// ---------------------------------------------------------------------------
// Ending a round
// ---------------------------------------------------------------------------

/** Clear the round's interval timer. Safe to call when there is none. */
function clearRoundTimer(session) {
  if (session.round && session.round.timerId) {
    clearInterval(session.round.timerId);
    session.round.timerId = null;
  }
}

/** Requirement 9, Requirement 11  Single round exit, answer revealed. Requirement 13  Master handover. */
function endRound(session, reason) {
  clearRoundTimer(session);
  const answer = session.answer;
  const winner =
    reason === END_REASON.CORRECT && session.round
      ? session.players.get(session.round.winnerId)
      : null;
  for (const p of session.players.values()) {
    p.locked = true;
    p.attemptsLeft = 0;
  }
  rotateMaster(session);
  session.question = null;
  session.answer = null;
  session.round = null;
  session.status = STATUS.ENDED;
  return { ok: true, reason, answer, winner, session };
}

/** R13  Round-robin the master role on join order. */
function rotateMaster(session) {
  if (session.order.length <= 1) {
    return session.masterId;
  }
  let idx = session.order.indexOf(session.masterId);
  if (idx === -1) {
    session.masterId = session.order[0];
    return session.masterId;
  }
  idx = (idx + 1) % session.order.length;
  session.masterId = session.order[idx];
  return session.masterId;
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

/**
 * R4 player count / R12 scores. The snapshot every client renders from.
 * NEVER puts session.answer in the payload - that only goes out in GAME_ENDED.
 */
function toPublicState(session) {
  const { status } = session;

  const players = [...session.players.values()]
    .map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      attemptsLeft: p.attemptsLeft,
      locked: p.locked,
      isMaster: p.id === session.masterId,
    }))
    .sort((a, b) => b.score - a.score);

  return {
    id: session.id,
    status,
    masterId: session.masterId,
    playerCount: session.players.size,
    players,
    question: status === STATUS.IN_PROGRESS ? session.question : null,
    hasQuestion: Boolean(session.question),
    endsAt: session.round ? session.round.endsAt : null,
    attemptsAllowed: RULES.ATTEMPTS_PER_PLAYER,
    minPlayers: RULES.MIN_PLAYERS_TO_START,
    canStart:
      status !== STATUS.IN_PROGRESS &&
      Boolean(session.question) &&
      session.players.size >= RULES.MIN_PLAYERS_TO_START,
  };
}

module.exports = {
  RULES,
  STATUS,
  END_REASON,
  makePlayer,
  create,
  join,
  leave,
  setQuestion,
  startGame,
  isCorrect,
  submitGuess,
  clearRoundTimer,
  endRound,
  rotateMaster,
  toPublicState,
};
