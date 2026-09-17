export const COLORS = ["red", "yellow", "green", "blue"];

export const TYPES = {
  NUMBER: "number",
  SKIP: "skip",
  REVERSE: "reverse",
  DRAW2: "draw2",
  DRAW4: "draw4",
  SKIP_EVERYONE: "skipEveryone",
  DISCARD_ALL: "discardAll",
  WILD_REVERSE_DRAW4: "wildReverseDraw4",
  WILD_DRAW6: "wildDraw6",
  WILD_REVERSE_DRAW8: "wildReverseDraw8",
  WILD_DRAW10: "wildDraw10",
  WILD_COLOR_ROULETTE: "wildColorRoulette",
  WILD_DISCARD_ALL: "wildDiscardAll",
  WILD_FINAL_ATTACK: "wildFinalAttack",
  WILD_SUDDEN_DEATH: "wildSuddenDeath",
};

let nextId = 1;

function card(partial) {
  return { id: `c${nextId++}`, ...partial };
}

export function resetCardIds() {
  nextId = 1;
}

export function drawValue(card) {
  if (!card) return 0;
  switch (card.type) {
    case TYPES.DRAW2:
      return 2;
    case TYPES.DRAW4:
    case TYPES.WILD_REVERSE_DRAW4:
      return 4;
    case TYPES.WILD_DRAW6:
      return 6;
    case TYPES.WILD_REVERSE_DRAW8:
      return 8;
    case TYPES.WILD_DRAW10:
      return 10;
    default:
      return 0;
  }
}

export function isWild(card) {
  return (
    card.type === TYPES.WILD_REVERSE_DRAW4 ||
    card.type === TYPES.WILD_DRAW6 ||
    card.type === TYPES.WILD_REVERSE_DRAW8 ||
    card.type === TYPES.WILD_DRAW10 ||
    card.type === TYPES.WILD_COLOR_ROULETTE ||
    card.type === TYPES.WILD_DISCARD_ALL ||
    card.type === TYPES.WILD_FINAL_ATTACK ||
    card.type === TYPES.WILD_SUDDEN_DEATH
  );
}

export function isDrawCard(card) {
  return drawValue(card) > 0;
}

export function isActionCard(card) {
  return card.type !== TYPES.NUMBER;
}

export function createDeck() {
  resetCardIds();
  const deck = [];

  for (const color of COLORS) {
    for (let n = 0; n <= 10; n++) {
      const copies = n === 0 || n === 10 ? 2 : 3;
      for (let i = 0; i < copies; i++) {
        deck.push(
          card({
            color,
            type: TYPES.NUMBER,
            value: n,
            symbol: String(n),
          })
        );
      }
    }

    for (let i = 0; i < 2; i++) {
      deck.push(card({ color, type: TYPES.SKIP, value: null, symbol: "skip" }));
      deck.push(card({ color, type: TYPES.REVERSE, value: null, symbol: "reverse" }));
      deck.push(card({ color, type: TYPES.DRAW2, value: 2, symbol: "+2" }));
    }

    deck.push(card({ color, type: TYPES.DRAW4, value: 4, symbol: "+4" }));
    deck.push(card({ color, type: TYPES.DISCARD_ALL, value: null, symbol: "discardAll" }));
    deck.push(card({ color, type: TYPES.SKIP_EVERYONE, value: null, symbol: "skipEveryone" }));
  }

  for (let i = 0; i < 4; i++) {
    deck.push(card({ color: null, type: TYPES.WILD_REVERSE_DRAW4, value: 4, symbol: "wildReverse+4" }));
    deck.push(card({ color: null, type: TYPES.WILD_DRAW6, value: 6, symbol: "wild+6" }));
    deck.push(card({ color: null, type: TYPES.WILD_DRAW10, value: 10, symbol: "wild+10" }));
    deck.push(card({ color: null, type: TYPES.WILD_COLOR_ROULETTE, value: null, symbol: "roulette" }));
  }

  for (let i = 0; i < 4; i++) {
    deck.push(card({ color: null, type: TYPES.WILD_REVERSE_DRAW8, value: 8, symbol: "wildReverse+8" }));
  }
  for (let i = 0; i < 8; i++) {
    deck.push(card({ color: null, type: TYPES.WILD_DISCARD_ALL, value: null, symbol: "wildDiscardAll" }));
  }
  for (let i = 0; i < 2; i++) {
    deck.push(card({ color: null, type: TYPES.WILD_FINAL_ATTACK, value: null, symbol: "finalAttack" }));
    deck.push(card({ color: null, type: TYPES.WILD_SUDDEN_DEATH, value: null, symbol: "suddenDeath" }));
  }

  return shuffle(deck);
}

export function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function cardLabel(card) {
  if (!card) return "";
  const color = card.color ? capitalize(card.color) : "Wild";
  switch (card.type) {
    case TYPES.NUMBER:
      return `${color} ${card.value}`;
    case TYPES.SKIP:
      return `${color} Skip`;
    case TYPES.REVERSE:
      return `${color} Reverse`;
    case TYPES.DRAW2:
      return `${color} +2`;
    case TYPES.DRAW4:
      return `${color} +4`;
    case TYPES.SKIP_EVERYONE:
      return `${color} Skip Everyone`;
    case TYPES.DISCARD_ALL:
      return `${color} Discard All`;
    case TYPES.WILD_REVERSE_DRAW4:
      return "Wild Reverse +4";
    case TYPES.WILD_DRAW6:
      return "Wild +6";
    case TYPES.WILD_REVERSE_DRAW8:
      return "Wild Reverse +8";
    case TYPES.WILD_DRAW10:
      return "Wild +10";
    case TYPES.WILD_COLOR_ROULETTE:
      return "Wild Color Roulette";
    case TYPES.WILD_DISCARD_ALL:
      return "Wild Discard All";
    case TYPES.WILD_FINAL_ATTACK:
      return "Wild Final Attack";
    case TYPES.WILD_SUDDEN_DEATH:
      return "Wild Sudden Death";
    default:
      return color;
  }
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
