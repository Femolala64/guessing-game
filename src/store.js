/**
 * Session registry - the only place sessions are held.
 *
 * In-memory on purpose: the game is live-only. Restart the server and every
 * session is gone. That is acceptable; it is noted in the README.
 */

/** sessionId -> session object */
const sessions = new Map();

/** socketId -> sessionId, so a disconnect can find its session in O(1). */
const socketIndex = new Map();

const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 - they get misread

/** Generate an unused 6-character id. */
function generateId() {
  let candidate = '';
  do {
    candidate = '';
    for (let i = 0; i < 6; i++) {
      candidate += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
    }
  } while (sessions.has(candidate));
  return candidate;
}

function get(sessionId) {
  return sessions.get(sessionId);
}

function save(session) {
  sessions.set(session.id, session);
  return session;
}

/** Remove the session and every one of its players' socket-index entries. */
function remove(sessionId) {
  const session = sessions.get(sessionId);
  if (session) {
    for (const sid of session.players.keys()) {
      socketIndex.delete(sid);
    }
  }
  sessions.delete(sessionId);
}

function indexSocket(socketId, sessionId) {
  socketIndex.set(socketId, sessionId);
}

function unindexSocket(socketId) {
  socketIndex.delete(socketId);
}

/** The session this socket is in, or undefined. Goes through the index. */
function findBySocket(socketId) {
  const sessionId = socketIndex.get(socketId);
  return sessionId ? sessions.get(sessionId) : undefined;
}

function stats() {
  return { sessions: sessions.size, sockets: socketIndex.size };
}

module.exports = {
  sessions,
  socketIndex,
  generateId,
  get,
  save,
  remove,
  indexSocket,
  unindexSocket,
  findBySocket,
  stats
};
