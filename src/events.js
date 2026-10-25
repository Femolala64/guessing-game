/**
 * Socket event names.
 *
 * One source of truth shared by server and client so a typo cannot silently
 * create a listener nobody emits to. The client loads this file as a plain
 * script (see public/index.html) and the server requires it.
 *
 */
(function (root, factory) {
  const EVENTS = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = EVENTS;
  } else {
    root.EVENTS = EVENTS;
  }
})(typeof self !== "undefined" ? self : this, function () {
  return {
    // --- client -> server -------------------------------------------------
    CREATE_SESSION: "session:create", // { name }                -> creates session, caller becomes master
    JOIN_SESSION: "session:join", // { sessionId, name }
    LEAVE_SESSION: "session:leave", // {}
    SET_QUESTION: "question:set", // { question, answer }     master only
    START_GAME: "game:start", // {}                       master only
    SUBMIT_GUESS: "guess:submit", // { guess }
    SEND_CHAT: "chat:send", // { text }

    // --- server -> client -------------------------------------------------
    SESSION_STATE: "session:state", // full snapshot, see session.js toPublicState()
    SESSION_ERROR: "session:error", // { code, message }        validation / rule refusals
    CHAT_MESSAGE: "chat:message", // { kind, from, text, at }
    GAME_STARTED: "game:started", // { question, endsAt, attemptsAllowed }
    GUESS_RESULT: "guess:result", // { correct, attemptsLeft, locked }
    GAME_ENDED: "game:ended", // { reason, answer, winner|null, scores }
    TIMER_TICK: "timer:tick", // { secondsLeft }
  };
});
