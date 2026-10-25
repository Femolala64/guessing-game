The split that matters: **`session.js` knows nothing about sockets, and `handlers.js` knows nothing about game rules.** That is what makes the rules testable without a browser.

A second rule holds throughout: the server is authoritative. The client hides a button as a courtesy, but every refusal — joining mid-round, guessing while locked, starting without three players — is re-checked server-side. `toPublicState()` never carries the answer; it is released only in the `GAME_ENDED` event.

## Requirement map

Every bullet in the brief, and where it is satisfied.

| #   | Requirement                                                               | Where                                                           |
| --- | ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | Chat-style interface                                                      | `public/index.html` `#log`, `handlers.js` `say()`               |
| 2   | Start a session (game master)                                             | `session.create()`                                              |
| 3   | Others join before start                                                  | `session.join()`                                                |
| 4   | See number of players connected                                           | `session.toPublicState()` `playerCount` → `#player-count`       |
| 5   | Master creates question + answer                                          | `session.setQuestion()`                                         |
| 6   | Master-only start, more than two players                                  | `session.startGame()`                                           |
| 7   | Question shown to each player, 3 attempts each                            | `session.startGame()`, `GAME_STARTED` emit                      |
| 8   | No joining while in progress                                              | `session.join()`                                                |
| 9   | Ends on correct answer or 60s expiry                                      | `session.submitGuess()`, `handlers.armTimer()`                  |
| 10  | Correct answer: others locked, winner + answer shown, "You have won", +10 | `submitGuess()` → `endRound()`, `app.js renderGameEnded()`      |
| 11  | Expiry: others locked, no winner, no points, answer shown                 | `armTimer()` timeout path → `endRound()`                        |
| 12  | Players see each other's scores                                           | `toPublicState().players` → `#players`                          |
| 13  | New master after each round                                               | `endRound()` → `rotateMaster()`                                 |
| 14  | Session deleted when all players have left                                | `session.leave()`                                               |
| 15  | Validate inputs                                                           | `src/validate.js`, called by every handler before any rule runs |

`endRound()` is the single exit point for a round — both the win path and the timeout path go through it, so the two cannot drift apart.

## Decisions the brief leaves open

The brief does not settle these, so each was chosen deliberately.

1. **The game master gets no attempts.** They know the answer, so they are locked for their own round and their guess box is hidden.
2. **A round does not end early when every player is out of attempts.** The brief names exactly two end conditions, so the clock runs down rather than adding a third.
3. **Chat stays open during a round.** Players can talk, including about the answer. The game is social; policing it would be a rule the brief never asked for.
4. **If the room drops below three players mid-round, the round is abandoned** — answer revealed, no winner, no points. Continuing with two would contradict the three-player minimum the round started under.
5. **Answer matching is case-insensitive and whitespace-tolerant, and nothing more.** No fuzzy matching, no "4" versus "four". Stated rather than half-built.

## Known limits

- State is in-memory and single-process: a restart drops every session, and the app does not scale past one instance without a shared adapter.
- No authentication. A name is a label, not an identity, and a reconnect is a new player.
- No persistence of scores between sessions.
