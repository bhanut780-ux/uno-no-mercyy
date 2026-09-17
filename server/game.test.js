import {
  createRoom,
  createPlayer,
  startGame,
  serialize,
  botDecision,
  playCard,
  drawAction,
  chooseColor,
  chooseSwap,
  chooseRoulette,
  callUno,
  challengePlus4,
  useCoin,
  PHASE,
} from "./game.js";
import { createDeck, TYPES } from "./cards.js";
import assert from "node:assert/strict";
import { test } from "node:test";

test("deck has 192 cards with expansion", () => {
  assert.equal(createDeck().length, 192);
});

function fillerCard(id, color = "yellow") {
  return { id, color, type: TYPES.NUMBER, value: 2, symbol: "2" };
}

function setupDuel() {
  const room = createRoom("CHAL", createPlayer("a", "Ash"));
  room.players.push(createPlayer("b", "Bea"));
  startGame(room);
  room.phase = PHASE.PLAYING;
  room.pending = null;
  room.stackAmount = 0;
  room.stackMin = 0;
  room.challenge = null;
  room.direction = 1;
  room.currentPlayerIndex = 0;
  room.currentColor = "red";
  room.discardPile = [{ id: "top", color: "red", type: TYPES.NUMBER, value: 3, symbol: "3" }];
  room.drawPile = Array.from({ length: 30 }, (_, i) => fillerCard(`d${i}`));
  return room;
}

test("winning a +4 challenge makes them draw 4", () => {
  const room = setupDuel();
  const a = room.players[0];
  const b = room.players[1];
  a.hand = [
    { id: "p4", color: "red", type: TYPES.DRAW4, value: 4, symbol: "+4" },
    { id: "r7", color: "red", type: TYPES.NUMBER, value: 7, symbol: "7" },
  ];
  b.hand = [fillerCard("b1", "green")];
  playCard(room, "a", "p4");
  assert.equal(room.challenge?.guilty, true);
  assert.equal(room.currentPlayerIndex, 1);
  const aBefore = a.hand.length;
  const bBefore = b.hand.length;
  challengePlus4(room, "b");
  assert.equal(a.hand.length, aBefore + 4);
  assert.equal(b.hand.length, bBefore);
  assert.equal(room.stackAmount, 0);
  assert.equal(room.currentPlayerIndex, 1);
});

test("losing a +4 challenge makes you draw 6", () => {
  const room = setupDuel();
  const a = room.players[0];
  const b = room.players[1];
  a.hand = [{ id: "p4", color: "blue", type: TYPES.DRAW4, value: 4, symbol: "+4" }, fillerCard("a2", "green")];
  b.hand = [fillerCard("b1", "green")];
  room.currentColor = "blue";
  room.discardPile = [{ id: "top", color: "blue", type: TYPES.NUMBER, value: 3, symbol: "3" }];
  playCard(room, "a", "p4");
  assert.equal(room.challenge?.guilty, false);
  const bBefore = b.hand.length;
  challengePlus4(room, "b");
  assert.equal(b.hand.length, bBefore + 6);
  assert.equal(room.stackAmount, 0);
  assert.equal(room.currentPlayerIndex, 0);
});

test("bots can finish a game", () => {
  const room = createRoom("TEST", createPlayer("a", "MercyBot", { bot: true }));
  room.players.push(createPlayer("b", "StackBot", { bot: true }));
  startGame(room);

  let steps = 0;
  while (room.phase !== PHASE.GAME_OVER && steps++ < 2500) {
    const actorId = room.pending?.playerId || room.players[room.currentPlayerIndex].id;
    const actor = room.players.find((p) => p.id === actorId);
    const decision = botDecision(room, actor);
    if (!decision) break;
    if (decision.action === "callUno") {
      callUno(room, actor.id);
      continue;
    }
    if (decision.action === "play") playCard(room, actor.id, decision.cardId);
    else if (decision.action === "draw") drawAction(room, actor.id);
    else if (decision.action === "chooseColor") chooseColor(room, actor.id, decision.color);
    else if (decision.action === "chooseSwap") chooseSwap(room, actor.id, decision.targetId);
    else if (decision.action === "chooseRoulette") chooseRoulette(room, actor.id, decision.color);
    else if (decision.action === "challenge") challengePlus4(room, actor.id);
    else if (decision.action === "useCoin") useCoin(room, actor.id);
  }

  assert.equal(room.phase, PHASE.GAME_OVER);
  const view = serialize(room, "a");
  assert.ok(view.players.length === 2);
});
