import {
  COLORS,
  TYPES,
  createDeck,
  shuffle,
  drawValue,
  isWild,
  isDrawCard,
  cardLabel,
} from "./cards.js";

export const PHASE = {
  LOBBY: "lobby",
  PLAYING: "playing",
  CHOOSE_COLOR: "chooseColor",
  CHOOSE_SWAP: "chooseSwap",
  CHOOSE_ROULETTE: "chooseRoulette",
  MERCY_SAVE: "mercySave",
  GAME_OVER: "gameOver",
};

const MERCY_LIMIT = 25;
const HAND_SIZE = 7;
const BOT_NAMES = ["MercyBot", "StackBot", "ChaosBot", "DrawBot", "SkipBot"];

export function createRoom(code, host) {
  return {
    code,
    hostId: host.id,
    phase: PHASE.LOBBY,
    players: [host],
    drawPile: [],
    discardPile: [],
    currentColor: null,
    direction: 1,
    currentPlayerIndex: 0,
    stackAmount: 0,
    stackMin: 0,
    pending: null,
    challenge: null,
    unoVulnerable: null,
    winnerId: null,
    winnerReason: null,
    log: [],
    events: [],
    chat: [],
    startedAt: null,
  };
}

export function createPlayer(id, name, { bot = false } = {}) {
  return {
    id,
    name: String(name || "Player").trim().slice(0, 16) || "Player",
    bot,
    connected: true,
    hand: [],
    calledUno: false,
    eliminated: false,
    knockoutBy: null,
    coin: { side: "mercy", used: false, armed: false },
  };
}

export function nextBotName(room) {
  const used = new Set(room.players.map((p) => p.name));
  return BOT_NAMES.find((n) => !used.has(n)) || `Bot ${room.players.length + 1}`;
}

export function startGame(room) {
  const active = room.players.filter((p) => p.connected || p.bot);
  if (active.length < 2) {
    throw new Error("Need at least 2 players to start");
  }
  if (active.length > 6) {
    throw new Error("Maximum 6 players");
  }

  room.players = active;
  for (const p of room.players) {
    p.hand = [];
    p.calledUno = false;
    p.eliminated = false;
    p.knockoutBy = null;
    p.coin = { side: p.coin?.side || (p.bot ? "nomercy" : "mercy"), used: false, armed: false };
  }

  room.drawPile = createDeck();
  room.discardPile = [];
  room.direction = 1;
  room.stackAmount = 0;
  room.stackMin = 0;
  room.pending = null;
  room.challenge = null;
  room.unoVulnerable = null;
  room.winnerId = null;
  room.winnerReason = null;
  room.events = [];
  room.startedAt = Date.now();

  for (let i = 0; i < HAND_SIZE; i++) {
    for (const p of room.players) {
      p.hand.push(drawOne(room));
    }
  }

  let starter = drawOne(room);
  let guard = 0;
  while (starter && isActionCardLike(starter) && guard < 40) {
    room.drawPile.push(starter);
    room.drawPile = shuffle(room.drawPile);
    starter = drawOne(room);
    guard++;
  }
  room.discardPile.push(starter);
  room.currentColor = starter.color;
  room.currentPlayerIndex = 0;
  room.phase = PHASE.PLAYING;
  pushLog(room, `Game started. First card is ${cardLabel(starter)}.`);
  emit(room, "started", { firstCard: starter });
  return room;
}

function isActionCardLike(card) {
  return card.type !== TYPES.NUMBER;
}

function drawOne(room) {
  if (room.drawPile.length === 0) {
    reshuffle(room);
  }
  if (room.drawPile.length === 0) return null;
  return room.drawPile.pop();
}

function reshuffle(room) {
  if (room.discardPile.length <= 1) {
    const extra = [];
    for (const p of room.players) {
      if (p.eliminated && p.hand.length) {
        extra.push(...p.hand);
        p.hand = [];
      }
    }
    if (extra.length) {
      room.drawPile = shuffle(extra);
    }
    return;
  }
  const top = room.discardPile.pop();
  const rest = room.discardPile;
  room.discardPile = [top];
  for (const p of room.players) {
    if (p.eliminated && p.hand.length) {
      rest.push(...p.hand);
      p.hand = [];
    }
  }
  room.drawPile = shuffle(rest);
  pushLog(room, "Discard pile shuffled into a new draw pile.");
  emit(room, "reshuffle", {});
}

export function topCard(room) {
  return room.discardPile[room.discardPile.length - 1] || null;
}

export function currentPlayer(room) {
  return room.players[room.currentPlayerIndex] || null;
}

export function alivePlayers(room) {
  return room.players.filter((p) => !p.eliminated);
}

export function canPlayCard(room, card, hand = null) {
  if (!card) return false;
  if (room.phase !== PHASE.PLAYING) return false;

  if (room.stackAmount > 0) {
    return isDrawCard(card) && drawValue(card) >= room.stackMin;
  }

  const top = topCard(room);
  if (!top) return true;
  if (isWild(card)) return true;
  if (card.color && card.color === room.currentColor) return true;
  if (card.type === TYPES.NUMBER && top.type === TYPES.NUMBER && card.value === top.value) {
    return true;
  }
  if (card.type !== TYPES.NUMBER && card.type === top.type) return true;
  return false;
}

export function playableCards(room, player) {
  return player.hand.filter((c) => canPlayCard(room, c, player.hand));
}

export function playCard(room, playerId, cardId) {
  assertTurn(room, playerId);
  closeUnoWindow(room, playerId);
  const player = getPlayer(room, playerId);
  const card = player.hand.find((c) => c.id === cardId);
  if (!card) throw new Error("You don't have that card");
  if (!canPlayCard(room, card, player.hand)) {
    throw new Error("That card doesn't match");
  }

  const colorBefore = room.currentColor;
  const guilty = player.hand.some((c) => c.id !== cardId && c.color === colorBefore);
  room.challenge = null;

  player.hand = player.hand.filter((c) => c.id !== cardId);
  room.discardPile.push(card);
  if (!isWild(card)) {
    room.currentColor = card.color;
  }

  emit(room, "play", {
    playerId,
    card,
    remaining: player.hand.length,
  });
  pushLog(room, `${player.name} played ${cardLabel(card)}.`);

  if (player.hand.length === 1 && !player.calledUno) {
    room.unoVulnerable = playerId;
  } else if (player.hand.length !== 1) {
    player.calledUno = false;
    if (room.unoVulnerable === playerId) room.unoVulnerable = null;
  }

  applyCardEffect(room, player, card, { colorBefore, guilty });
}

function maybeWin(room, player) {
  if (player.hand.length === 0 && !player.eliminated && room.phase !== PHASE.GAME_OVER) {
    win(room, player, "emptied their hand");
    return true;
  }
  return false;
}

function isPlus4(card) {
  return card.type === TYPES.DRAW4 || card.type === TYPES.WILD_REVERSE_DRAW4;
}

function applyCardEffect(room, player, card, challengeInfo = {}) {
  if (card.type === TYPES.DISCARD_ALL) {
    applyDiscardAll(room, player, card);
    if (player.hand.length === 1 && !player.calledUno) {
      room.unoVulnerable = player.id;
    }
    if (maybeWin(room, player)) return;
    advanceTurn(room);
    return;
  }

  if (maybeWin(room, player)) return;

  if (card.type === TYPES.NUMBER && card.value === 7) {
    const targets = alivePlayers(room).filter((p) => p.id !== player.id);
    if (targets.length === 1) {
      swapHands(room, player, targets[0]);
      advanceTurn(room);
      return;
    }
    if (targets.length > 1) {
      room.phase = PHASE.CHOOSE_SWAP;
      room.pending = { type: "swap", playerId: player.id };
      return;
    }
    advanceTurn(room);
    return;
  }

  if (card.type === TYPES.NUMBER && card.value === 0) {
    passHands(room);
    advanceTurn(room);
    return;
  }

  if (card.type === TYPES.SKIP) {
    advanceTurn(room, 2);
    return;
  }

  if (card.type === TYPES.REVERSE) {
    if (alivePlayers(room).length === 2) {
      emit(room, "reverse", { direction: room.direction });
      pushLog(room, `${player.name} reverses and plays again.`);
      return;
    }
    room.direction *= -1;
    emit(room, "reverse", { direction: room.direction });
    pushLog(room, "Direction reversed.");
    advanceTurn(room);
    return;
  }

  if (card.type === TYPES.SKIP_EVERYONE) {
    pushLog(room, `${player.name} skipped everyone and plays again.`);
    emit(room, "skipEveryone", { playerId: player.id });
    return;
  }

  if (card.type === TYPES.NUMBER && card.value === 10) {
    pushLog(room, `${player.name} played a 10 and goes again.`);
    emit(room, "playAgain", { playerId: player.id });
    return;
  }

  if (card.type === TYPES.WILD_DISCARD_ALL) {
    room.phase = PHASE.CHOOSE_COLOR;
    room.pending = { type: "wildDiscard", playerId: player.id };
    return;
  }

  if (card.type === TYPES.WILD_FINAL_ATTACK) {
    applyFinalAttack(room, player);
    if (room.phase === PHASE.GAME_OVER) return;
    room.phase = PHASE.CHOOSE_COLOR;
    room.pending = { type: "colorThenSkipVictim", playerId: player.id, skipId: nextAlive(room, player)?.id };
    return;
  }

  if (card.type === TYPES.WILD_SUDDEN_DEATH) {
    applySuddenDeath(room, player);
    if (room.phase === PHASE.GAME_OVER) return;
    room.phase = PHASE.CHOOSE_COLOR;
    room.pending = { type: "colorThenAdvance", playerId: player.id };
    return;
  }

  if (isDrawCard(card)) {
    const printed = drawValue(card);
    const freshStack = room.stackAmount === 0;
    let value = printed;
    if (player.coin?.armed && player.coin.side === "nomercy" && !player.coin.used) {
      value *= 2;
      player.coin.used = true;
      player.coin.armed = false;
      pushLog(room, `${player.name} used NO MERCY — +${printed} becomes +${value}!`);
      emit(room, "noMercy", { playerId: player.id, printed, value });
    }
    room.stackAmount += value;
    room.stackMin = printed;
    if (freshStack) {
      room.challenge = {
        playerId: player.id,
        colorBefore: challengeInfo.colorBefore,
        guilty: Boolean(challengeInfo.guilty),
        printed,
      };
    }

    if (card.type === TYPES.WILD_REVERSE_DRAW4 || card.type === TYPES.WILD_REVERSE_DRAW8) {
      if (alivePlayers(room).length === 2) {
        room.challenge = null;
        room.phase = PHASE.CHOOSE_COLOR;
        room.pending = { type: "colorThenSelfStack", playerId: player.id };
        return;
      }
      room.direction *= -1;
      emit(room, "reverse", { direction: room.direction });
      room.phase = PHASE.CHOOSE_COLOR;
      room.pending = { type: "colorThenStack", playerId: player.id };
      return;
    }

    if (isWild(card)) {
      room.phase = PHASE.CHOOSE_COLOR;
      room.pending = { type: "colorThenStack", playerId: player.id };
      return;
    }

    advanceTurn(room);
    return;
  }

  if (card.type === TYPES.WILD_COLOR_ROULETTE) {
    advanceTurn(room);
    const victim = currentPlayer(room);
    if (!victim) return;
    room.phase = PHASE.CHOOSE_ROULETTE;
    room.pending = { type: "roulette", playerId: victim.id };
    pushLog(room, `${victim.name} must pick a color and spin the roulette.`);
    return;
  }

  advanceTurn(room);
}

function applyDiscardAll(room, player, card) {
  const extras = player.hand.filter((c) => c.color === card.color);
  if (!extras.length) return;
  player.hand = player.hand.filter((c) => c.color !== card.color);
  const top = room.discardPile.pop();
  room.discardPile.push(...extras, top);
  emit(room, "discardAll", {
    playerId: player.id,
    color: card.color,
    count: extras.length,
  });
  pushLog(
    room,
    `${player.name} discarded ${extras.length} more ${card.color} card${extras.length === 1 ? "" : "s"}.`
  );
}

function nextAlive(room, player) {
  const alive = alivePlayers(room);
  const idx = alive.findIndex((p) => p.id === player.id);
  if (idx < 0 || alive.length < 2) return null;
  return alive[(idx + room.direction + alive.length) % alive.length];
}

function applyFinalAttack(room, player) {
  const actions = player.hand.filter((c) => c.type !== TYPES.NUMBER).length;
  const victim = nextAlive(room, player);
  emit(room, "finalAttack", { playerId: player.id, actions, mega: actions >= 7 });
  if (actions >= 7) {
    pushLog(room, `${player.name} unleashed FINAL ATTACK with ${actions} action cards!`);
    if (victim) {
      giveCards(room, victim, 25);
      checkMercy(room, victim, player.id);
    }
    for (const p of alivePlayers(room)) {
      if (p.id === player.id || p.id === victim?.id) continue;
      giveCards(room, p, 5);
      checkMercy(room, p, player.id);
    }
  } else {
    pushLog(room, `${player.name} used Final Attack — ${victim?.name || "nobody"} draws ${actions}.`);
    if (victim) {
      giveCards(room, victim, actions);
      checkMercy(room, victim, player.id);
    }
  }
}

function applySuddenDeath(room, player) {
  pushLog(room, `${player.name} played Sudden Death — everyone draws to 24!`);
  emit(room, "suddenDeath", { playerId: player.id });
  for (const p of alivePlayers(room)) {
    while (p.hand.length < 24) {
      const c = drawOne(room);
      if (!c) break;
      p.hand.push(c);
    }
    p.calledUno = false;
    checkMercy(room, p, player.id);
  }
}

function activateMercyHand(room, player) {
  const dumped = player.hand;
  player.hand = [];
  if (room.discardPile.length) {
    const top = room.discardPile.pop();
    room.discardPile.unshift(...dumped);
    room.discardPile.push(top);
  } else {
    room.discardPile.unshift(...dumped);
  }
  giveCards(room, player, 7);
  player.coin.used = true;
  player.coin.armed = false;
  player.calledUno = false;
  emit(room, "mercyCoin", { playerId: player.id });
  pushLog(room, `${player.name} used MERCY and drew a fresh 7.`);
}

export function flipCoin(room, playerId) {
  const player = getPlayer(room, playerId);
  if (player.coin.used) throw new Error("Coin already used");
  player.coin.side = player.coin.side === "mercy" ? "nomercy" : "mercy";
  player.coin.armed = false;
}

export function useCoin(room, playerId) {
  const player = getPlayer(room, playerId);
  if (player.eliminated) throw new Error("You're out");
  if (player.coin.used) throw new Error("Coin already used");

  if (room.phase === PHASE.MERCY_SAVE && room.pending?.playerId === playerId) {
    if (player.coin.side !== "mercy") throw new Error("That coin is No Mercy");
    activateMercyHand(room, player);
    room.pending = null;
    room.phase = PHASE.PLAYING;
    if (currentPlayer(room)?.id === playerId) advanceTurn(room);
    return;
  }

  assertTurn(room, playerId);
  if (player.coin.side === "mercy") {
    activateMercyHand(room, player);
    return;
  }
  player.coin.armed = true;
  pushLog(room, `${player.name} armed NO MERCY — the next draw card they play is doubled.`);
}

export function declineMercy(room, playerId) {
  if (room.phase !== PHASE.MERCY_SAVE || room.pending?.playerId !== playerId) {
    throw new Error("No Mercy save pending");
  }
  const player = getPlayer(room, playerId);
  const causedById = room.pending.causedById;
  room.pending = null;
  room.phase = PHASE.PLAYING;
  player.coin.used = true;
  return knockOut(room, player, causedById);
}

function swapHands(room, a, b) {
  const tmp = a.hand;
  a.hand = b.hand;
  b.hand = tmp;
  a.calledUno = a.hand.length === 1;
  b.calledUno = b.hand.length === 1;
  room.unoVulnerable = null;
  emit(room, "swap", { a: a.id, b: b.id, aCount: a.hand.length, bCount: b.hand.length });
  pushLog(room, `${a.name} swapped hands with ${b.name}.`);
}

function passHands(room) {
  const alive = alivePlayers(room);
  if (alive.length < 2) return;
  const hands = alive.map((p) => p.hand);
  for (let i = 0; i < alive.length; i++) {
    const from = (i - room.direction + alive.length) % alive.length;
    alive[i].hand = hands[from];
    alive[i].calledUno = alive[i].hand.length === 1;
  }
  room.unoVulnerable = null;
  emit(room, "passHands", { direction: room.direction });
  pushLog(room, "Everyone passed their hand in the current direction.");
}

export function chooseColor(room, playerId, color) {
  if (room.phase !== PHASE.CHOOSE_COLOR) throw new Error("Not choosing a color");
  if (!room.pending || room.pending.playerId !== playerId) {
    throw new Error("Not your choice");
  }
  if (!COLORS.includes(color)) throw new Error("Invalid color");

  room.currentColor = color;
  const pending = room.pending;
  room.pending = null;
  room.phase = PHASE.PLAYING;
  emit(room, "color", { color, playerId });
  pushLog(room, `Color is now ${color}.`);

  if (pending.type === "colorThenStack") {
    advanceTurn(room);
    return;
  }
  if (pending.type === "colorThenSelfStack") {
    return;
  }
  if (pending.type === "wildDiscard") {
    applyDiscardAll(room, getPlayer(room, playerId), { color });
    const actor = getPlayer(room, playerId);
    if (actor.hand.length === 1 && !actor.calledUno) room.unoVulnerable = actor.id;
    if (maybeWin(room, actor)) return;
    advanceTurn(room);
    return;
  }
  if (pending.type === "colorThenSkipVictim") {
    const skipId = pending.skipId;
    if (skipId && getPlayer(room, skipId) && !getPlayer(room, skipId).eliminated) {
      advanceTurn(room, 2);
    } else {
      advanceTurn(room);
    }
    return;
  }
  if (pending.type === "colorThenAdvance") {
    advanceTurn(room);
  }
}

export function chooseSwap(room, playerId, targetId) {
  if (room.phase !== PHASE.CHOOSE_SWAP) throw new Error("Not swapping");
  if (!room.pending || room.pending.playerId !== playerId) {
    throw new Error("Not your choice");
  }
  const player = getPlayer(room, playerId);
  const target = getPlayer(room, targetId);
  if (target.eliminated) throw new Error("That player is out");
  if (target.id === player.id) throw new Error("Pick someone else");
  swapHands(room, player, target);
  room.pending = null;
  room.phase = PHASE.PLAYING;
  advanceTurn(room);
}

export function chooseRoulette(room, playerId, color) {
  if (room.phase !== PHASE.CHOOSE_ROULETTE) throw new Error("Not spinning roulette");
  if (!room.pending || room.pending.playerId !== playerId) {
    throw new Error("Not your choice");
  }
  if (!COLORS.includes(color)) throw new Error("Invalid color");

  const player = getPlayer(room, playerId);
  const revealed = [];
  let found = null;
  let guard = 0;
  while (guard++ < 200) {
    const c = drawOne(room);
    if (!c) break;
    revealed.push(c);
    if (c.color === color) {
      found = c;
      break;
    }
  }

  player.hand.push(...revealed);
  room.currentColor = color;
  room.pending = null;
  room.phase = PHASE.PLAYING;
  emit(room, "roulette", {
    playerId,
    color,
    revealed,
    found: Boolean(found),
  });
  pushLog(
    room,
    `${player.name} hit ${color} after revealing ${revealed.length} card${revealed.length === 1 ? "" : "s"}.`
  );

  if (checkMercy(room, player, currentPlayer(room)?.id)) return;
  player.calledUno = false;
  advanceTurn(room);
}

export function drawAction(room, playerId) {
  assertTurn(room, playerId);
  closeUnoWindow(room, playerId);
  const player = getPlayer(room, playerId);

  if (room.stackAmount > 0) {
    takeStack(room, player);
    return;
  }

  const drawn = [];
  let playable = null;
  let guard = 0;
  while (guard++ < 200) {
    const c = drawOne(room);
    if (!c) break;
    drawn.push(c);
    player.hand.push(c);
    if (checkMercy(room, player, null)) {
      emit(room, "draw", { playerId, cards: drawn, forcedPlay: null });
      return;
    }
    if (canPlayCard(room, c, player.hand)) {
      playable = c;
      break;
    }
  }

  emit(room, "draw", {
    playerId,
    count: drawn.length,
    cards: drawn,
    forcedPlay: playable,
  });
  pushLog(
    room,
    `${player.name} drew ${drawn.length} card${drawn.length === 1 ? "" : "s"}${playable ? " and must play" : ""}.`
  );

  player.calledUno = false;
  if (room.unoVulnerable === playerId) room.unoVulnerable = null;

  if (playable) {
    playCard(room, playerId, playable.id);
  } else {
    advanceTurn(room);
  }
}

function giveCards(room, player, amount) {
  const drawn = [];
  for (let i = 0; i < amount; i++) {
    const c = drawOne(room);
    if (!c) break;
    drawn.push(c);
    player.hand.push(c);
  }
  player.calledUno = false;
  if (room.unoVulnerable === player.id) room.unoVulnerable = null;
  return drawn;
}

function takeStack(room, player) {
  const amount = room.stackAmount;
  const drawn = giveCards(room, player, amount);
  room.stackAmount = 0;
  room.stackMin = 0;
  room.challenge = null;
  emit(room, "stackHit", { playerId: player.id, amount, cards: drawn });
  pushLog(room, `${player.name} took a +${amount} stack. Ouch.`);
  if (checkMercy(room, player, previousAlive(room, player)?.id)) return;
  advanceTurn(room);
}

export function challengePlus4(room, challengerId) {
  assertTurn(room, challengerId);
  if (!room.challenge) throw new Error("Nothing to challenge");
  if (room.challenge.playerId === challengerId) throw new Error("You can't challenge yourself");

  const challenger = getPlayer(room, challengerId);
  const accused = getPlayer(room, room.challenge.playerId);
  const { guilty, colorBefore, printed = 4 } = room.challenge;
  const penalty = printed + 2;
  const proof = accused.hand.filter((c) => c.color === colorBefore);

  room.challenge = null;
  room.stackAmount = 0;
  room.stackMin = 0;

  if (guilty) {
    giveCards(room, accused, printed);
    emit(room, "challenge", {
      won: true,
      challengerId,
      accusedId: accused.id,
      colorBefore,
      proof,
      drawn: printed,
    });
    pushLog(
      room,
      `${challenger.name} won the +${printed} challenge — ${accused.name} had ${colorBefore} and draws ${printed}.`
    );
    if (checkMercy(room, accused, challengerId)) return;
    return;
  }

  giveCards(room, challenger, penalty);
  emit(room, "challenge", {
    won: false,
    challengerId,
    accusedId: accused.id,
    colorBefore,
    proof,
    drawn: penalty,
  });
  pushLog(room, `${challenger.name} lost the +${printed} challenge and draws ${penalty}.`);
  if (checkMercy(room, challenger, accused.id)) return;
  advanceTurn(room);
}

function previousAlive(room, player) {
  const alive = alivePlayers(room);
  const idx = alive.findIndex((p) => p.id === player.id);
  if (idx < 0) return null;
  const prev = (idx - room.direction + alive.length) % alive.length;
  return alive[prev];
}

export function callUno(room, playerId) {
  const player = getPlayer(room, playerId);
  if (player.eliminated) throw new Error("You're out");
  if (player.hand.length !== 1 && player.hand.length !== 2) {
    throw new Error("You can only call UNO with 1 or 2 cards");
  }
  player.calledUno = true;
  if (room.unoVulnerable === playerId) room.unoVulnerable = null;
  emit(room, "uno", { playerId });
  pushLog(room, `${player.name} yelled UNO!`);
}

export function catchUno(room, catcherId, targetId) {
  if (room.phase === PHASE.LOBBY || room.phase === PHASE.GAME_OVER) {
    throw new Error("No game in progress");
  }
  if (room.unoVulnerable !== targetId) {
    throw new Error("They're not vulnerable");
  }
  const catcher = getPlayer(room, catcherId);
  const target = getPlayer(room, targetId);
  if (catcher.eliminated) throw new Error("You're out");
  if (target.calledUno || target.hand.length !== 1) {
    room.unoVulnerable = null;
    throw new Error("Too late");
  }

  room.unoVulnerable = null;
  const drawn = [];
  for (let i = 0; i < 2; i++) {
    const c = drawOne(room);
    if (!c) break;
    drawn.push(c);
    target.hand.push(c);
  }
  target.calledUno = false;
  emit(room, "caught", { catcherId, targetId, cards: drawn });
  pushLog(room, `${catcher.name} caught ${target.name} — draw 2!`);
  checkMercy(room, target, catcherId);
}

function checkMercy(room, player, causedById) {
  if (player.eliminated) return false;
  if (player.hand.length < MERCY_LIMIT) return false;
  if (player.coin && !player.coin.used && player.coin.side === "mercy") {
    if (player.bot) {
      activateMercyHand(room, player);
      return player.hand.length >= MERCY_LIMIT ? knockOut(room, player, causedById) : true;
    }
    room.phase = PHASE.MERCY_SAVE;
    room.pending = { type: "mercySave", playerId: player.id, causedById };
    emit(room, "mercySave", { playerId: player.id, count: player.hand.length });
    pushLog(room, `${player.name} hit ${player.hand.length} cards — Mercy coin can save them.`);
    return true;
  }
  return knockOut(room, player, causedById);
}

function knockOut(room, player, causedById) {
  player.eliminated = true;
  player.knockoutBy = causedById || null;
  player.calledUno = false;
  if (room.unoVulnerable === player.id) room.unoVulnerable = null;
  emit(room, "mercy", {
    playerId: player.id,
    count: player.hand.length,
    causedById,
  });
  pushLog(room, `${player.name} hit ${player.hand.length} cards and is OUT. No mercy.`);

  const alive = alivePlayers(room);
  if (alive.length === 1) {
    win(room, alive[0], "last player standing");
    return true;
  }
  if (alive.length === 0) {
    room.phase = PHASE.GAME_OVER;
    room.winnerId = null;
    room.winnerReason = "Everyone was knocked out";
    return true;
  }

  if (currentPlayer(room)?.id === player.id) {
    advanceTurn(room, 1, { skipMercyCheck: true });
  } else {
    syncCurrentIndex(room);
  }
  return true;
}

function win(room, player, reason) {
  room.phase = PHASE.GAME_OVER;
  room.winnerId = player.id;
  room.winnerReason = reason;
  room.stackAmount = 0;
  room.challenge = null;
  room.pending = null;
  emit(room, "win", { playerId: player.id, reason });
  pushLog(room, `${player.name} wins — ${reason}.`);
}

function advanceTurn(room, steps = 1, { skipMercyCheck } = {}) {
  if (room.phase === PHASE.GAME_OVER) return;
  const alive = alivePlayers(room);
  if (alive.length === 0) return;
  if (alive.length === 1) {
    win(room, alive[0], "last player standing");
    return;
  }

  let idx = room.currentPlayerIndex;
  let moved = 0;
  let guard = 0;
  while (moved < steps && guard++ < 20) {
    idx = (idx + room.direction + room.players.length) % room.players.length;
    if (!room.players[idx].eliminated) moved++;
  }
  room.currentPlayerIndex = idx;
  room.phase = PHASE.PLAYING;

  const next = currentPlayer(room);
  emit(room, "turn", { playerId: next?.id, stackAmount: room.stackAmount });
}

function closeUnoWindow(room, playerId) {
  if (room.unoVulnerable && room.unoVulnerable !== playerId) {
    room.unoVulnerable = null;
  }
}

function syncCurrentIndex(room) {
  if (currentPlayer(room)?.eliminated) {
    advanceTurn(room, 1);
  }
}

function assertTurn(room, playerId) {
  if (room.phase === PHASE.GAME_OVER) throw new Error("Game is over");
  if (room.phase === PHASE.LOBBY) throw new Error("Game hasn't started");
  if (room.phase === PHASE.CHOOSE_COLOR || room.phase === PHASE.CHOOSE_SWAP || room.phase === PHASE.CHOOSE_ROULETTE || room.phase === PHASE.MERCY_SAVE) {
    throw new Error("A choice is still pending");
  }
  const player = getPlayer(room, playerId);
  if (player.eliminated) throw new Error("You're out");
  if (currentPlayer(room)?.id !== playerId) throw new Error("Not your turn");
}

function getPlayer(room, id) {
  const p = room.players.find((x) => x.id === id);
  if (!p) throw new Error("Player not found");
  return p;
}

function pushLog(room, text) {
  room.log.push({ t: Date.now(), text });
  if (room.log.length > 80) room.log.splice(0, room.log.length - 80);
}

function emit(room, type, payload) {
  room.events.push({ type, payload, t: Date.now() });
  if (room.events.length > 30) room.events.splice(0, room.events.length - 30);
}

export function serialize(room, forPlayerId) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    currentColor: room.currentColor,
    direction: room.direction,
    currentPlayerId: currentPlayer(room)?.id || null,
    stackAmount: room.stackAmount,
    stackMin: room.stackMin,
    challenge: room.challenge
      ? {
          playerId: room.challenge.playerId,
          colorBefore: room.challenge.colorBefore,
          printed: room.challenge.printed || 4,
        }
      : null,
    pending: room.pending,
    unoVulnerable: room.unoVulnerable,
    winnerId: room.winnerId,
    winnerReason: room.winnerReason,
    topCard: topCard(room),
    drawCount: room.drawPile.length,
    discardCount: room.discardPile.length,
    log: room.log.slice(-24),
    events: room.events.slice(-8),
    chat: room.chat.slice(-40),
    you: forPlayerId,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      bot: p.bot,
      connected: p.connected,
      eliminated: p.eliminated,
      cardCount: p.hand.length,
      calledUno: p.calledUno,
      coin: p.coin,
      hand: p.id === forPlayerId ? sortHand(p.hand) : undefined,
    })),
  };
}

function sortHand(hand) {
  const colorOrder = { red: 0, yellow: 1, green: 2, blue: 3 };
  const typeOrder = {
    [TYPES.NUMBER]: 0,
    [TYPES.SKIP]: 1,
    [TYPES.REVERSE]: 2,
    [TYPES.DRAW2]: 3,
    [TYPES.DRAW4]: 4,
    [TYPES.DISCARD_ALL]: 5,
    [TYPES.SKIP_EVERYONE]: 6,
    [TYPES.WILD_REVERSE_DRAW4]: 7,
    [TYPES.WILD_DRAW6]: 8,
    [TYPES.WILD_REVERSE_DRAW8]: 9,
    [TYPES.WILD_DRAW10]: 10,
    [TYPES.WILD_COLOR_ROULETTE]: 11,
    [TYPES.WILD_DISCARD_ALL]: 12,
    [TYPES.WILD_FINAL_ATTACK]: 13,
    [TYPES.WILD_SUDDEN_DEATH]: 14,
  };
  return [...hand].sort((a, b) => {
    const ac = a.color ? colorOrder[a.color] : 9;
    const bc = b.color ? colorOrder[b.color] : 9;
    if (ac !== bc) return ac - bc;
    const at = typeOrder[a.type] ?? 20;
    const bt = typeOrder[b.type] ?? 20;
    if (at !== bt) return at - bt;
    return (a.value ?? 0) - (b.value ?? 0);
  });
}

export function botDecision(room, player) {
  if (room.phase === PHASE.MERCY_SAVE && room.pending?.playerId === player.id) {
    return { action: "useCoin" };
  }
  if (room.phase === PHASE.CHOOSE_COLOR && room.pending?.playerId === player.id) {
    return { action: "chooseColor", color: favoriteColor(player) };
  }
  if (room.phase === PHASE.CHOOSE_SWAP && room.pending?.playerId === player.id) {
    const targets = alivePlayers(room)
      .filter((p) => p.id !== player.id)
      .sort((a, b) => a.hand.length - b.hand.length);
    return { action: "chooseSwap", targetId: targets[0]?.id };
  }
  if (room.phase === PHASE.CHOOSE_ROULETTE && room.pending?.playerId === player.id) {
    return { action: "chooseRoulette", color: favoriteColor(player) || "red" };
  }
  if (room.phase !== PHASE.PLAYING) return null;
  if (currentPlayer(room)?.id !== player.id) return null;

  if (player.hand.length <= 2 && !player.calledUno) {
    return { action: "callUno" };
  }

  const playable = playableCards(room, player);
  if (
    player.coin &&
    !player.coin.used &&
    player.coin.side === "nomercy" &&
    !player.coin.armed &&
    playable.some((c) => drawValue(c) >= 6)
  ) {
    return { action: "useCoin" };
  }
  if (playable.length) {
    const card = pickBotCard(playable, player);
    return { action: "play", cardId: card.id };
  }
  if (room.challenge && room.challenge.playerId !== player.id) {
    if (Math.random() < 0.35) return { action: "challenge" };
  }
  return { action: "draw" };
}

function pickBotCard(playable, player) {
  const ranked = [...playable].sort((a, b) => botScore(b, player) - botScore(a, player));
  return ranked[0];
}

function botScore(card, player) {
  let s = 0;
  if (card.type === TYPES.WILD_DRAW10) s += 52;
  else if (card.type === TYPES.WILD_REVERSE_DRAW8) s += 48;
  else if (card.type === TYPES.WILD_FINAL_ATTACK) s += 46;
  else if (card.type === TYPES.WILD_SUDDEN_DEATH) s += 44;
  else if (card.type === TYPES.WILD_DRAW6) s += 40;
  else if (card.type === TYPES.WILD_DISCARD_ALL) s += 36;
  else if (card.type === TYPES.DRAW4) s += 35;
  else if (card.type === TYPES.DRAW2) s += 25;
  else if (card.type === TYPES.SKIP_EVERYONE) s += 30;
  else if (card.type === TYPES.DISCARD_ALL) {
    s += 20 + player.hand.filter((c) => c.color === card.color).length * 8;
  } else if (card.type === TYPES.SKIP) s += 18;
  else if (card.type === TYPES.REVERSE) s += 16;
  else if (card.type === TYPES.NUMBER && card.value === 7) s += 12;
  else if (card.type === TYPES.NUMBER && card.value === 0) s += 10;
  else if (card.type === TYPES.NUMBER) s += card.value;
  else if (isWild(card)) s += 8;
  return s;
}

function favoriteColor(player) {
  const counts = { red: 0, yellow: 0, green: 0, blue: 0 };
  for (const c of player.hand) {
    if (c.color) counts[c.color]++;
  }
  return COLORS.slice().sort((a, b) => counts[b] - counts[a])[0];
}
