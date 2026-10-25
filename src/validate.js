/**
 * Input validation.  Brief, Notice Board item 1: "Remember to validate inputs."
 *
 * Every function returns the SAME shape:
 *     { ok: true,  value: <cleaned value> }
 *     { ok: false, code: 'SOME_CODE', message: 'human readable' }
 *
 * Never throw from here. Handlers turn an { ok:false } into a SESSION_ERROR.
 */

const LIMITS = {
  NAME_MIN: 2,
  NAME_MAX: 20,
  QUESTION_MIN: 5,
  QUESTION_MAX: 200,
  ANSWER_MIN: 1,
  ANSWER_MAX: 60,
  GUESS_MIN: 1,
  GUESS_MAX: 60,
  CHAT_MAX: 300,
  SESSION_ID_LENGTH: 6
};

/** Collapse whitespace and trim. Returns '' for anything that is not a string. */
function clean(input) {
  if (typeof input !== 'string') {
    return '';
  }
  return input.trim().replace(/\s+/g, ' ');
}

/** Player display name. */
function validateName(input) {
  const name = clean(input);

  if (!name) {
    return { ok: false, code: 'NAME_REQUIRED', message: 'Enter a name.' };
  }
  if (name.length < LIMITS.NAME_MIN || name.length > LIMITS.NAME_MAX) {
    return {
      ok: false,
      code: 'NAME_LENGTH',
      message: `Name must be ${LIMITS.NAME_MIN} to ${LIMITS.NAME_MAX} characters.`
    };
  }
  if (!/^[a-zA-Z0-9 _-]+$/.test(name)) {
    return {
      ok: false,
      code: 'NAME_CHARS',
      message: 'Name can only use letters, numbers, spaces, _ and -.'
    };
  }
  return { ok: true, value: name };
}

/** Session id, as typed into the join box. */
function validateSessionId(input) {
  const id = clean(input).toUpperCase();
  const pattern = new RegExp(`^[A-Z0-9]{${LIMITS.SESSION_ID_LENGTH}}$`);

  if (!pattern.test(id)) {
    return {
      ok: false,
      code: 'SESSION_ID_INVALID',
      message: `Enter a ${LIMITS.SESSION_ID_LENGTH}-character session code.`
    };
  }
  return { ok: true, value: id };
}

/** The master's question and answer, validated together. */
function validateQuestion(question, answer) {
  const q = clean(question);
  const a = clean(answer);

  if (q.length < LIMITS.QUESTION_MIN || q.length > LIMITS.QUESTION_MAX) {
    return {
      ok: false,
      code: 'QUESTION_LENGTH',
      message: `Question must be ${LIMITS.QUESTION_MIN} to ${LIMITS.QUESTION_MAX} characters.`
    };
  }
  if (a.length < LIMITS.ANSWER_MIN || a.length > LIMITS.ANSWER_MAX) {
    return {
      ok: false,
      code: 'ANSWER_LENGTH',
      message: `Answer must be ${LIMITS.ANSWER_MIN} to ${LIMITS.ANSWER_MAX} characters.`
    };
  }
  // Answer is stored as typed so it can be shown back verbatim; the
  // case-insensitive compare happens at guess time (session.isCorrect).
  return { ok: true, value: { question: q, answer: a } };
}

/** A player's guess. */
function validateGuess(input) {
  const guess = clean(input);

  if (!guess || guess.length > LIMITS.GUESS_MAX) {
    return { ok: false, code: 'GUESS_INVALID', message: 'Enter a guess.' };
  }
  return { ok: true, value: guess };
}

/** A free chat line (the interface is a chat interface, requirement 1). */
function validateChat(input) {
  const text = clean(input);

  if (!text || text.length > LIMITS.CHAT_MAX) {
    return { ok: false, code: 'CHAT_INVALID', message: 'Message is empty or too long.' };
  }
  return { ok: true, value: text };
}

module.exports = {
  LIMITS,
  clean,
  validateName,
  validateSessionId,
  validateQuestion,
  validateGuess,
  validateChat
};
