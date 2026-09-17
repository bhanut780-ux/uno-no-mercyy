import express from "express";
import http from "http";
import { Server } from "socket.io";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  createRoom,
  createPlayer,
  startGame,
  playCard,
  drawAction,
  chooseColor,
  chooseSwap,
  chooseRoulette,
  callUno,
  catchUno,
  challengePlus4,
  flipCoin,
  useCoin,
  declineMercy,
  serialize,
  botDecision,
  nextBotName,
  PHASE,
  currentPlayer,
} from "./game.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "../public")));
app.get("/api/info", (_req, res) => {
  res.json({ urls: lanUrls(PORT) });
});
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

const rooms = new Map();
const socketRoom = new Map();
const botTimers = new Map();

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  if (rooms.has(code)) return makeCode();
  return code;
}

function uniqueName(room, name) {
  const base = String(name || "Player").trim().slice(0, 16) || "Player";
  const taken = new Set(room.players.map((p) => p.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < 20; i++) {
    const n = `${base} ${i}`;
    if (!taken.has(n.toLowerCase())) return n;
  }
  return `${base} ${Math.floor(Math.random() * 90 + 10)}`;
}

function broadcast(code) {
  const room = rooms.get(code);
  if (!room) return;
  const sockets = io.sockets.adapter.rooms.get(code);
  if (sockets) {
    for (const sid of sockets) {
      io.to(sid).emit("state", serialize(room, sid));
    }
  }
  scheduleBots(room);
}

function emitError(socket, message) {
  socket.emit("toast", { type: "error", message });
}

function scheduleBots(room) {
  const existing = botTimers.get(room.code);
  if (existing) {
    clearTimeout(existing);
    botTimers.delete(room.code);
  }
  if (room.phase === PHASE.LOBBY || room.phase === PHASE.GAME_OVER) return;

  const actorId =
    room.pending?.playerId ||
    (room.phase === PHASE.PLAYING || room.phase === PHASE.MERCY_SAVE ? currentPlayer(room)?.id : null);
  const actor = room.players.find((p) => p.id === actorId);
  if (!actor?.bot || actor.eliminated) return;

  const delay = 700 + Math.random() * 900;
  const timer = setTimeout(() => runBot(room.code, actor.id), delay);
  botTimers.set(room.code, timer);
}

function runBot(code, botId) {
  const room = rooms.get(code);
  if (!room) return;
  const bot = room.players.find((p) => p.id === botId);
  if (!bot?.bot) return;

  try {
    const decision = botDecision(room, bot);
    if (!decision) return;
    if (decision.action === "callUno") {
      callUno(room, bot.id);
      const next = botDecision(room, bot);
      applyDecision(room, bot, next);
    } else {
      applyDecision(room, bot, decision);
    }
  } catch (err) {
    room.log.push({ t: Date.now(), text: `${bot.name} hesitated (${err.message}).` });
    try {
      if (room.phase === PHASE.PLAYING && currentPlayer(room)?.id === bot.id) {
        drawAction(room, bot.id);
      }
    } catch {
      /* ignore */
    }
  }
  broadcast(code);
}

function applyDecision(room, bot, decision) {
  if (!decision) return;
  switch (decision.action) {
    case "play":
      playCard(room, bot.id, decision.cardId);
      break;
    case "draw":
      drawAction(room, bot.id);
      break;
    case "chooseColor":
      chooseColor(room, bot.id, decision.color);
      break;
    case "chooseSwap":
      if (decision.targetId) chooseSwap(room, bot.id, decision.targetId);
      break;
    case "chooseRoulette":
      chooseRoulette(room, bot.id, decision.color);
      break;
    case "challenge":
      challengePlus4(room, bot.id);
      break;
    case "useCoin":
      useCoin(room, bot.id);
      break;
    case "callUno":
      callUno(room, bot.id);
      break;
      callUno(room, bot.id);
      break;
    default:
      break;
  }
}

io.on("connection", (socket) => {
  socket.on("createRoom", ({ name }) => {
    try {
      const code = makeCode();
      const player = createPlayer(socket.id, name);
      const room = createRoom(code, player);
      rooms.set(code, room);
      socket.join(code);
      socketRoom.set(socket.id, code);
      socket.emit("joined", { code, playerId: socket.id, host: true });
      broadcast(code);
    } catch (err) {
      emitError(socket, err.message);
    }
  });

  socket.on("joinRoom", ({ code, name }) => {
    try {
      const room = rooms.get(String(code || "").trim().toUpperCase());
      if (!room) throw new Error("Room not found");
      if (room.phase !== PHASE.LOBBY) throw new Error("That game already started");
      if (room.players.filter((p) => p.connected || p.bot).length >= 6) {
        throw new Error("Room is full (6 players)");
      }
      const player = createPlayer(socket.id, uniqueName(room, name));
      room.players.push(player);
      socket.join(room.code);
      socketRoom.set(socket.id, room.code);
      socket.emit("joined", { code: room.code, playerId: socket.id, host: false });
      broadcast(room.code);
    } catch (err) {
      emitError(socket, err.message);
    }
  });

  socket.on("addBot", () => {
    const code = socketRoom.get(socket.id);
    const room = rooms.get(code);
    if (!room) return;
    if (room.hostId !== socket.id) return emitError(socket, "Only the host can add bots");
    if (room.phase !== PHASE.LOBBY) return emitError(socket, "Game already started");
    if (room.players.length >= 6) return emitError(socket, "Room is full");
    const bot = createPlayer(`bot-${Date.now()}-${Math.random().toString(16).slice(2)}`, nextBotName(room), {
      bot: true,
    });
    room.players.push(bot);
    broadcast(code);
  });

  socket.on("startGame", () => {
    const code = socketRoom.get(socket.id);
    const room = rooms.get(code);
    if (!room) return;
    if (room.hostId !== socket.id) return emitError(socket, "Only the host can start");
    try {
      startGame(room);
      broadcast(code);
    } catch (err) {
      emitError(socket, err.message);
    }
  });

  socket.on("playCard", ({ cardId }) => {
    act(socket, (room) => playCard(room, socket.id, cardId));
  });

  socket.on("draw", () => {
    act(socket, (room) => drawAction(room, socket.id));
  });

  socket.on("chooseColor", ({ color }) => {
    act(socket, (room) => chooseColor(room, socket.id, color));
  });

  socket.on("chooseSwap", ({ playerId }) => {
    act(socket, (room) => chooseSwap(room, socket.id, playerId));
  });

  socket.on("chooseRoulette", ({ color }) => {
    act(socket, (room) => chooseRoulette(room, socket.id, color));
  });

  socket.on("challenge", () => {
    act(socket, (room) => challengePlus4(room, socket.id));
  });

  socket.on("flipCoin", () => {
    act(socket, (room) => flipCoin(room, socket.id));
  });

  socket.on("useCoin", () => {
    act(socket, (room) => useCoin(room, socket.id));
  });

  socket.on("declineMercy", () => {
    act(socket, (room) => declineMercy(room, socket.id));
  });

  socket.on("callUno", () => {
    act(socket, (room) => callUno(room, socket.id));
  });

  socket.on("catchUno", ({ playerId }) => {
    act(socket, (room) => catchUno(room, socket.id, playerId));
  });

  socket.on("chat", ({ message }) => {
    const code = socketRoom.get(socket.id);
    const room = rooms.get(code);
    if (!room) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;
    const text = String(message || "").trim().slice(0, 160);
    if (!text) return;
    room.chat.push({ t: Date.now(), name: player.name, text });
    if (room.chat.length > 50) room.chat.splice(0, room.chat.length - 50);
    io.to(code).emit("chat", { name: player.name, text, t: Date.now() });
  });

  socket.on("playAgain", () => {
    const code = socketRoom.get(socket.id);
    const room = rooms.get(code);
    if (!room) return;
    if (room.hostId !== socket.id) return emitError(socket, "Only the host can restart");
    try {
      startGame(room);
      broadcast(code);
    } catch (err) {
      emitError(socket, err.message);
    }
  });

  socket.on("disconnect", () => {
    const code = socketRoom.get(socket.id);
    socketRoom.delete(socket.id);
    const room = rooms.get(code);
    if (!room) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;
    player.connected = false;

    if (room.phase === PHASE.LOBBY) {
      room.players = room.players.filter((p) => p.id !== socket.id);
      if (!room.players.some((p) => p.connected && !p.bot)) {
        rooms.delete(code);
        return;
      }
      if (room.hostId === socket.id) {
        const nextHost = room.players.find((p) => p.connected && !p.bot);
        if (nextHost) room.hostId = nextHost.id;
      }
    } else if (room.hostId === socket.id) {
      const nextHost = room.players.find((p) => p.connected && !p.bot);
      if (nextHost) room.hostId = nextHost.id;
    }

    const humans = room.players.filter((p) => !p.bot && p.connected);
    if (humans.length === 0) {
      const t = botTimers.get(code);
      if (t) clearTimeout(t);
      rooms.delete(code);
      return;
    }
    broadcast(code);
  });
});

function lanUrls(port) {
  const urls = [`http://localhost:${port}`];
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === "IPv4" && !net.internal) {
        urls.push(`http://${net.address}:${port}`);
      }
    }
  }
  return urls;
}

function act(socket, fn) {
  const code = socketRoom.get(socket.id);
  const room = rooms.get(code);
  if (!room) return emitError(socket, "You're not in a room");
  try {
    fn(room);
    broadcast(code);
  } catch (err) {
    emitError(socket, err.message);
  }
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`UNO No Mercy running:\n  ${lanUrls(PORT).join("\n  ")}`);
});
