/**
 * HTTP + Socket.IO boot. Plumbing only - no game rules live in this file.
 
 */
const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const registerHandlers = require("./src/handlers");

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());

// Serve the client. public/ is static; src/events.js is exposed so the browser
// can reuse the same event-name constants the server uses.
app.use(express.static(path.join(__dirname, "public")));
app.get("/events.js", (_req, res) => {
  res
    .type("application/javascript")
    .sendFile(path.join(__dirname, "src", "events.js"));
});

app.get("/health", (_req, res) =>
  res.json({ ok: true, uptime: process.uptime() }),
);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

io.on("connection", (socket) => {
  console.log("[socket] connected", socket.id);
  registerHandlers(io, socket);

  socket.on("disconnect", (reason) => {
    console.log("[socket] disconnected", socket.id, reason);
  });
});

server.listen(PORT, () => {
  console.log(`Guessing game listening on http://localhost:${PORT}`);
});

module.exports = { app, server, io };
