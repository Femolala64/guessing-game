/**
 * Client. Renders whatever the server last sent and enforces nothing:
 * disabling a button is a courtesy, every rule is re-checked server-side.
 */
(function () {
  ("use strict");

  const socket = io();

  // --- element handles ----------------------------------------------------
  const el = {
    gate: document.getElementById("gate"),
    room: document.getElementById("room"),
    name: document.getElementById("name"),
    code: document.getElementById("session-code"),
    btnCreate: document.getElementById("btn-create"),
    btnJoin: document.getElementById("btn-join"),
    gateError: document.getElementById("gate-error"),

    sessionIdValue: document.getElementById("session-id-value"),
    btnCopy: document.getElementById("btn-copy"),
    playerCount: document.getElementById("player-count"),
    players: document.getElementById("players"),
    statusLine: document.getElementById("status-line"),
    btnLeave: document.getElementById("btn-leave"),

    questionBanner: document.getElementById("question-banner"),
    questionText: document.getElementById("question-text"),
    timer: document.getElementById("timer"),
    timerValue: document.getElementById("timer-value"),
    log: document.getElementById("log"),

    masterControls: document.getElementById("master-controls"),
    qInput: document.getElementById("q-input"),
    aInput: document.getElementById("a-input"),
    btnSetQuestion: document.getElementById("btn-set-question"),
    btnStart: document.getElementById("btn-start"),

    guessControls: document.getElementById("guess-controls"),
    guessInput: document.getElementById("guess-input"),
    btnGuess: document.getElementById("btn-guess"),
    attempts: document.getElementById("attempts"),

    chatInput: document.getElementById("chat-input"),
    btnChat: document.getElementById("btn-chat"),
    roomError: document.getElementById("room-error"),
  };

  /** Last SESSION_STATE snapshot. Single source of truth for rendering. */
  let state = null;

  // --- helpers ------------------------------------------------------------

  /** Escape anything interpolated into innerHTML. */
  function esc(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }

  function show(node, on) {
    node.hidden = !on;
  }

  function flash(node, text) {
    node.textContent = text;
    show(node, Boolean(text));
    if (text) setTimeout(() => show(node, false), 5000);
  }

  function me() {
    return socket.id;
  }

  // --- outgoing -----------------------------------------------------------

  el.btnCreate.addEventListener("click", () => {
    socket.emit(EVENTS.CREATE_SESSION, { name: el.name.value });
  });

  el.btnJoin.addEventListener("click", () => {
    socket.emit(EVENTS.JOIN_SESSION, {
      sessionId: el.code.value,
      name: el.name.value,
    });
  });

  el.btnSetQuestion.addEventListener("click", () => {
    socket.emit(EVENTS.SET_QUESTION, {
      question: el.qInput.value,
      answer: el.aInput.value,
    });
    el.qInput.value = "";
    el.aInput.value = "";
  });

  el.btnStart.addEventListener("click", () => {
    socket.emit(EVENTS.START_GAME, {});
  });

  function sendGuess() {
    const g = el.guessInput.value;
    if (!g.trim()) return;
    socket.emit(EVENTS.SUBMIT_GUESS, { guess: g });
    el.guessInput.value = "";
  }
  el.btnGuess.addEventListener("click", sendGuess);
  el.guessInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendGuess();
  });

  function sendChat() {
    const t = el.chatInput.value;
    if (!t.trim()) return;
    socket.emit(EVENTS.SEND_CHAT, { text: t });
    el.chatInput.value = "";
  }
  el.btnChat.addEventListener("click", sendChat);
  el.chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendChat();
  });

  el.btnLeave.addEventListener("click", () => {
    socket.emit(EVENTS.LEAVE_SESSION, {});
    location.reload();
  });

  el.btnCopy.addEventListener("click", () => {
    navigator.clipboard.writeText(el.sessionIdValue.textContent.trim());
    el.btnCopy.textContent = "copied";
    setTimeout(() => {
      el.btnCopy.textContent = "copy";
    }, 1500);
  });

  // --- incoming -----------------------------------------------------------

  socket.on("connect", () => console.log("connected", socket.id));

  socket.on(EVENTS.SESSION_ERROR, (err) => {
    const target = state ? el.roomError : el.gateError;
    flash(target, err && err.message ? err.message : "Something went wrong.");
  });

  socket.on(EVENTS.SESSION_STATE, (next) => {
    state = next;
    show(el.gate, false);
    show(el.room, true);
    el.sessionIdValue.textContent = next.id;
    render(next);
  });

  socket.on(EVENTS.CHAT_MESSAGE, (m) => appendMessage(m));

  socket.on(EVENTS.TIMER_TICK, ({ secondsLeft }) => {
    show(el.timer, true);
    el.timerValue.textContent = secondsLeft;
    el.timer.classList.toggle("low", secondsLeft <= 10);
  });

  socket.on(EVENTS.GAME_STARTED, ({ question, attemptsAllowed }) => {
    show(el.questionBanner, true);
    el.questionText.textContent = question;
    el.attempts.textContent = attemptsAllowed + " attempts left";
  });

  socket.on(EVENTS.GUESS_RESULT, (r) => renderGuessResult(r));

  socket.on(EVENTS.GAME_ENDED, (payload) => renderGameEnded(payload));

  /** R4 player count, R12 scoreboard. Paints one SESSION_STATE snapshot. */
  function render(s) {
    el.playerCount.textContent = s.playerCount;

    // Scoreboard (R4 count, R12 scores)
    el.players.innerHTML = s.players
      .map((p) => {
        const cls = [
          p.isMaster ? "is-master" : "",
          p.id === me() ? "is-you" : "",
          p.locked ? "is-locked" : "",
        ]
          .join(" ")
          .trim();
        const tag = p.isMaster ? '<span class="tag">master</span>' : "";
        return `<li class="${cls}"><span class="nm">${esc(p.name)}</span>${tag}<span class="sc">${p.score}</span></li>`;
      })
      .join("");

    const iAmMaster = s.masterId === me();
    const inProgress = s.status === "in_progress";
    const myself = s.players.find((p) => p.id === me());

    // Master controls: only the master, only when a round is not running
    show(el.masterControls, iAmMaster && !inProgress);
    el.btnStart.disabled = !s.canStart;

    // Guess box: only mid-round, only if I still have attempts
    show(
      el.guessControls,
      inProgress &&
        Boolean(myself) &&
        !myself.locked &&
        myself.attemptsLeft > 0,
    );
    if (myself && inProgress) {
      el.attempts.textContent = myself.attemptsLeft + " attempts left";
    }

    // Question banner and timer live only during a round
    show(el.questionBanner, inProgress);
    if (!inProgress) show(el.timer, false);

    // One status line per state
    let status = "";
    if (inProgress) {
      status = "Round in progress.";
    } else if (s.status === "ended") {
      const master = s.players.find((p) => p.id === s.masterId);
      status = master
        ? `Round over. ${esc(master.name)} is the new game master.`
        : "Round over.";
    } else if (iAmMaster && !s.hasQuestion) {
      status = "Set a question.";
    } else if (s.playerCount < s.minPlayers) {
      status = `Waiting for players. ${s.playerCount} of ${s.minPlayers} connected.`;
    } else if (s.canStart) {
      status = "Ready. Start when you are.";
    } else {
      status = "Waiting for the game master.";
    }
    el.statusLine.textContent = status;
  }

  /** R1  Append one line to the chat log. */
  function appendMessage(m) {
    const div = document.createElement("div");
    div.className = "msg " + m.kind;
    if (m.kind === "chat") {
      div.innerHTML = `<span class="who">${esc(m.from)}</span>${esc(m.text)}`;
    } else {
      div.innerHTML = esc(m.text);
    }
    el.log.appendChild(div);
    el.log.scrollTop = el.log.scrollHeight;
  }

  /**  /** A player's own guess outcome. The win is drawn by renderGameEnded instead. */
  function renderGuessResult(r) {
    if (r.correct) return; // GAME_ENDED handles the win for everyone

    el.attempts.textContent = r.attemptsLeft + " attempts left";
    if (r.locked) {
      show(el.guessControls, false);
      appendMessage({
        kind: "system",
        text: "Out of attempts. Watch the rest of the round.",
      });
    }
  }

  /** R10 winner announced, R11 timeout reveals the answer with no winner. */
  function renderGameEnded(payload) {
    show(el.guessControls, false);
    show(el.timer, false);
    show(el.questionBanner, false);

    if (payload.winner) {
      if (payload.winner.id === me()) {
        appendMessage({
          kind: "result you-won",
          text: `You have won. The answer was "${payload.answer}".`,
        });
      } else {
        appendMessage({
          kind: "result",
          text: `${payload.winner.name} won. The answer was "${payload.answer}".`,
        });
      }
    } else {
      appendMessage({
        kind: "result nowinner",
        text: `Time is up. No winner. The answer was "${payload.answer}".`,
      });
    }
  }
})();
