// Connect to same origin — Railway serves both static files and Socket.IO
const socket = io();

const $ = (id) => document.getElementById(id);
const screens = {
  home: $("screen-home"),
  lobby: $("screen-lobby"),
  game: $("screen-game"),
};

let state = null;
let myName = localStorage.getItem("uno-name") || "";
let lastShout = "";

$("name-input").value = myName;

const params = new URLSearchParams(location.search);
if (params.get("room")) {
  $("code-input").value = params.get("room").toUpperCase();
  $("btn-join").textContent = `Join ${params.get("room").toUpperCase()}`;
}

$("btn-create").onclick = () => {
  saveName();
  socket.emit("createRoom", { name: myName });
};
$("btn-join").onclick = () => {
  saveName();
  socket.emit("joinRoom", { name: myName, code: $("code-input").value });
};
$("name-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    if ($("code-input").value.trim()) $("btn-join").click();
    else $("btn-create").click();
  }
});
$("code-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("btn-join").click();
});
$("btn-rules").onclick = () => $("rules").classList.remove("hidden");
if ($("btn-rules-game")) $("btn-rules-game").onclick = () => $("rules").classList.remove("hidden");
if ($("link-rules")) $("link-rules").onclick = (e) => { e.preventDefault(); $("rules").classList.remove("hidden"); };
if ($("link-about")) $("link-about").onclick = (e) => { e.preventDefault(); $("rules").classList.remove("hidden"); };
if ($("link-help")) $("link-help").onclick = (e) => { e.preventDefault(); $("rules").classList.remove("hidden"); };
if ($("btn-close-chat")) $("btn-close-chat").onclick = () => $("side-panel").classList.remove("open");

let soundEnabled = true;
if ($("btn-sound-toggle")) {
  $("btn-sound-toggle").onclick = () => {
    soundEnabled = !soundEnabled;
    $("btn-sound-toggle").textContent = soundEnabled ? "🔊" : "🔇";
    toast(soundEnabled ? "Sound enabled" : "Sound muted");
  };
}

document.querySelectorAll(".room-quick-join").forEach((btn) => {
  btn.onclick = () => {
    saveName();
    const code = btn.dataset.code;
    $("code-input").value = code;
    socket.emit("joinRoom", { name: myName, code });
  };
});

$("close-rules").onclick = () => $("rules").classList.add("hidden");
$("rules").addEventListener("click", (e) => {
  if (e.target.id === "rules") $("rules").classList.add("hidden");
});
$("btn-copy").onclick = async () => {
  const url = `${location.origin}/?room=${$("lobby-code").textContent}`;
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied");
  } catch {
    toast(url);
  }
};
$("btn-bot").onclick = () => socket.emit("addBot");
$("btn-start").onclick = () => socket.emit("startGame");
$("btn-uno").onclick = () => socket.emit("callUno");
$("btn-coin").onclick = () => {
  if (!state) return;
  const me = state.players.find((p) => p.id === state.you);
  if (state.phase === "mercySave" && state.pending?.playerId === state.you) {
    socket.emit("useCoin");
    return;
  }
  if (me?.coin && !me.coin.used && state.phase === "lobby") {
    socket.emit("flipCoin");
    return;
  }
  socket.emit("useCoin");
};
$("btn-challenge").onclick = () => socket.emit("challenge");
$("draw-pile").onclick = () => {
  if (!state || state.currentPlayerId !== state.you || state.phase !== "playing") return;
  socket.emit("draw");
};
$("btn-chat-toggle").onclick = () => $("side-panel").classList.toggle("open");
$("chat-form").onsubmit = (e) => {
  e.preventDefault();
  const message = $("chat-input").value;
  $("chat-input").value = "";
  if (message.trim()) socket.emit("chat", { message });
};

socket.on("joined", ({ code }) => {
  history.replaceState({}, "", `/?room=${code}`);
  show("lobby");
  $("lobby-code").textContent = code;
});

socket.on("state", (next) => {
  const prev = state;
  state = next;
  if (next.phase === "lobby") {
    show("lobby");
    renderLobby(next);
  } else {
    show("game");
    renderGame(next, prev);
  }
});

socket.on("toast", ({ message, type }) => toast(message, type));
socket.on("chat", (msg) => {
  if (state) {
    state.chat = [...(state.chat || []), msg];
    renderLog(state);
  }
});

function saveName() {
  myName = $("name-input").value.trim() || "Player";
  localStorage.setItem("uno-name", myName);
}

function show(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.toggle("hidden", key !== name);
  });
}

function renderLobby(s) {
  $("lobby-code").textContent = s.code;
  $("lobby-players").innerHTML = s.players
    .map(
      (p) =>
        `<li><span>${escapeHtml(p.name)}${p.bot ? " · CPU" : ""}</span><span>${
          p.id === s.hostId ? "HOST" : "READY"
        }</span></li>`
    )
    .join("");
  const host = s.hostId === s.you;
  $("btn-start").disabled = !host || s.players.length < 2;
  $("btn-bot").disabled = !host || s.players.length >= 6;
  $("lan-hint").textContent = host ? "Share the code. Same Wi‑Fi friends can open the link." : "Waiting for host…";
  if (window.location.hostname === 'localhost') {
    fetch("/api/info")
      .then((r) => r.json())
      .then(({ urls }) => {
        const extra = urls.filter((u) => !u.includes("localhost"));
        if (extra.length) {
          $("lan-hint").textContent = `On this Wi‑Fi: ${extra[0]}/?room=${s.code}`;
        }
      })
      .catch(() => {});
  } else {
    const shareUrl = `${location.origin}/?room=${s.code}`;
    $("lan-hint").textContent = host ? `Share: ${shareUrl}` : "Waiting for host…";
  }
}

let matchStartTime = null;
let timerInterval = null;

function updateMatchTimer(s) {
  if (s.phase === "playing" && !matchStartTime) {
    matchStartTime = Date.now();
    if (!timerInterval) {
      timerInterval = setInterval(() => {
        if (!matchStartTime) return;
        const elapsed = Math.floor((Date.now() - matchStartTime) / 1000);
        const mins = String(Math.floor(elapsed / 60)).padStart(2, "0");
        const secs = String(elapsed % 60).padStart(2, "0");
        const timerEl = $("match-timer");
        if (timerEl) timerEl.textContent = `${mins}:${secs}`;
      }, 1000);
    }
  } else if (s.phase === "gameOver") {
    matchStartTime = null;
  }
}

function renderTopScores(s) {
  const el = $("top-scores");
  if (!el) return;
  el.innerHTML = s.players
    .map((p) => {
      const isMe = p.id === s.you;
      const isTurn = p.id === s.currentPlayerId;
      return `<div class="score-item ${isTurn ? "turn" : ""}">
        <span class="score-name">${isMe ? "You" : escapeHtml(p.name)}</span>
        <span class="score-val">${p.eliminated ? "OUT" : p.cardCount}</span>
      </div>`;
    })
    .join("");
}

function renderGame(s, prev) {
  $("room-chip").textContent = s.code;
  const me = s.players.find((p) => p.id === s.you);
  const current = s.players.find((p) => p.id === s.currentPlayerId);
  const myTurn = s.currentPlayerId === s.you && s.phase === "playing";

  $("turn-banner").textContent = turnText(s, me, current);
  $("status-line").textContent = statusText(s, me);
  $("draw-count").textContent = s.drawCount;
  $("draw-pile").classList.toggle("can-draw", myTurn);
  $("draw-pile").title = s.stackAmount && myTurn ? `Take +${s.stackAmount}` : "Draw";

  // Direction arrows SVG
  const dirSvg = $("dir-arrows-svg");
  if (dirSvg) {
    dirSvg.classList.toggle("ccw", s.direction < 0);
  }
  const dirArrowOld = $("dir-arrow");
  if (dirArrowOld) {
    dirArrowOld.classList.toggle("ccw", s.direction < 0);
  }

  $("color-chip").className = `color-chip ${s.currentColor || ""}`;
  $("stack-badge").classList.toggle("hidden", !s.stackAmount);
  $("stack-badge").textContent = `+${s.stackAmount}`;
  const printed = s.challenge?.printed || 4;
  const canChallenge = myTurn && s.challenge && s.challenge.playerId !== s.you;
  $("btn-challenge").classList.toggle("hidden", !canChallenge);
  $("btn-challenge").textContent = `Challenge +${printed}`;

  const unoReady = me && !me.eliminated && (me.cardCount === 1 || me.cardCount === 2);
  $("btn-uno").classList.toggle("ready", unoReady && !me.calledUno);
  $("btn-uno").disabled = !unoReady;
  const coin = me?.coin;
  $("btn-coin").classList.toggle("hidden", !coin || (s.phase !== "lobby" && s.phase !== "playing" && s.phase !== "mercySave"));
  if (coin) {
    $("btn-coin").textContent = coin.used
      ? "Coin used"
      : coin.armed
        ? "NO MERCY armed"
        : coin.side === "mercy"
          ? "Mercy coin"
          : "No Mercy coin";
    $("btn-coin").disabled = coin.used || (s.phase === "playing" && s.currentPlayerId !== s.you && s.pending?.playerId !== s.you);
  }

  updateMatchTimer(s);
  renderTopScores(s);

  renderOpponents(s, me);
  renderDiscard(s.topCard);
  renderHand(s, me, myTurn);
  renderLog(s);
  renderModal(s, me);
  shoutFrom(s, prev);

  if (s.phase === "gameOver") showWinner(s);
  if (window.innerWidth > 980) $("side-panel").classList.add("open");
}

function turnText(s, me, current) {
  if (s.phase === "gameOver") return s.winnerId === s.you ? "You win" : `${nameOf(s, s.winnerId)} wins`;
  if (s.pending?.playerId === s.you) return pendingText(s.phase);
  if (current?.id === s.you) {
    return s.stackAmount ? `Your turn — stack is +${s.stackAmount}` : "Your turn";
  }
  return `${current?.name || "Someone"}'s turn`;
}

function pendingText(phase) {
  if (phase === "chooseColor") return "Pick a color";
  if (phase === "chooseSwap") return "Swap with someone";
  if (phase === "chooseRoulette") return "Pick roulette color";
  return "Your move";
}

function statusText(s, me) {
  if (me?.eliminated) return "You're out — 25 card mercy rule.";
  if (s.unoVulnerable && s.unoVulnerable !== s.you) {
    return `${nameOf(s, s.unoVulnerable)} forgot UNO — catch them!`;
  }
  if (s.stackAmount && s.currentPlayerId === s.you) {
    if (s.challenge && s.challenge.playerId !== s.you) {
      const n = s.challenge.printed || 4;
      return `Stack, take +${s.stackAmount}, or challenge the +${n} (lose = you +${n + 2}, win = they +${n}).`;
    }
    return `Stack a +${s.stackMin} or higher, or take +${s.stackAmount}.`;
  }
  if (s.phase === "playing" && s.currentPlayerId === s.you) {
    return "Play a matching card, or draw until you can.";
  }
  return "";
}

function renderOpponents(s, me) {
  const others = s.players.filter((p) => p.id !== s.you);
  $("opponents").innerHTML = others
    .map((p) => {
      const backs = Math.min(p.cardCount, 6);
      const cards = Array.from({ length: backs }, (_, i) => {
        const r = (i - (backs - 1) / 2) * 8;
        return `<div class="card-back tiny" style="--r:${r}deg"></div>`;
      }).join("");

      const initials = p.bot ? "🤖" : (p.name ? p.name.slice(0, 2).toUpperCase() : "P");
      const isTurn = p.id === s.currentPlayerId;

      const catchBtn =
        s.unoVulnerable === p.id && !me?.eliminated
          ? `<button class="catch" data-catch="${p.id}">CATCH UNO</button>`
          : "";

      return `<article class="seat ${isTurn ? "turn" : ""} ${p.eliminated ? "out" : ""}">
        <div class="avatar">${initials}</div>
        <div class="nm" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
        <div class="card-badge">${p.eliminated ? "OUT" : `🂠 ${p.cardCount}`}${p.calledUno ? " · UNO" : ""}</div>
        <div class="mini-hand">${cards}</div>
        ${catchBtn}
      </article>`;
    })
    .join("");

  $("opponents").querySelectorAll("[data-catch]").forEach((btn) => {
    btn.onclick = () => socket.emit("catchUno", { playerId: btn.dataset.catch });
  });
}

function renderDiscard(card) {
  $("discard-pile").innerHTML = card ? cardEl(card, { mini: true }) : "";
}

function renderHand(s, me, myTurn) {
  const hand = me?.hand || [];
  $("hand").innerHTML = "";
  if (!hand.length) {
    $("hand").innerHTML = `<p class="muted">${me?.eliminated ? "Eliminated" : "No cards"}</p>`;
    return;
  }
  const n = hand.length;
  hand.forEach((card, i) => {
    const playable = myTurn && isPlayable(s, card);
    const html = cardEl(card, { playable, button: true });
    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    const el = wrap.firstElementChild;
    const spread = (i - (n - 1) / 2) * Math.min(4.5, 90 / n);
    el.style.transform = `rotate(${spread}deg)`;
    el.style.zIndex = String(i + 1);
    el.disabled = !playable;
    if (playable) {
      el.onclick = () => socket.emit("playCard", { cardId: card.id });
    }
    $("hand").appendChild(el);
  });
}

function isPlayable(s, card) {
  if (s.stackAmount > 0) {
    const v = drawVal(card);
    return v > 0 && v >= s.stackMin;
  }
  if (isWild(card)) return true;
  if (card.color && card.color === s.currentColor) return true;
  const top = s.topCard;
  if (!top) return true;
  if (card.type === "number" && top.type === "number" && card.value === top.value) return true;
  if (card.type !== "number" && card.type === top.type) return true;
  return false;
}

function drawVal(card) {
  if (card.type === "draw2") return 2;
  if (card.type === "draw4" || card.type === "wildReverseDraw4") return 4;
  if (card.type === "wildDraw6") return 6;
  if (card.type === "wildReverseDraw8") return 8;
  if (card.type === "wildDraw10") return 10;
  return 0;
}
function isWild(card) {
  return (
    card.type === "wildReverseDraw4" ||
    card.type === "wildDraw6" ||
    card.type === "wildReverseDraw8" ||
    card.type === "wildDraw10" ||
    card.type === "wildColorRoulette" ||
    card.type === "wildDiscardAll" ||
    card.type === "wildFinalAttack" ||
    card.type === "wildSuddenDeath"
  );
}

function cardEl(card, { playable = false, mini = false, button = false } = {}) {
  const color = card.color || "wild";
  const { face, corner } = faceFor(card);
  const tag = button ? "button" : "div";
  return `<${tag} class="card ${color} type-${card.type} ${mini ? "mini" : ""} ${playable ? "playable" : ""}" ${
    button ? `type="button"` : ""
  }>
    <span class="corner tl">${corner}</span>
    <div class="oval"><div class="face">${face}</div></div>
    <span class="corner br">${corner}</span>
  </${tag}>`;
}

const C = { r: "#e10600", y: "#f7d117", g: "#1b9a3c", b: "#1570c7", w: "#f6f1e4" };

function svg(inner) {
  return `<svg class="icon" viewBox="0 0 64 64" aria-hidden="true">${inner}</svg>`;
}
function miniRect(x, y, rot, fill, w = 14, h = 22) {
  return `<g transform="translate(${x} ${y}) rotate(${rot})">
    <rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="2.2" fill="${fill}" stroke="#141414" stroke-width="1.4"/>
  </g>`;
}
function sadTile(x, y, rot, fill) {
  return `<g transform="translate(${x} ${y}) rotate(${rot})">
    <rect x="-8" y="-10" width="16" height="20" rx="3.2" fill="${fill}" stroke="#141414" stroke-width="1.3"/>
    <circle cx="-3.2" cy="-2.2" r="1.35" fill="#141414"/>
    <circle cx="3.2" cy="-2.2" r="1.35" fill="#141414"/>
    <path d="M-3.4 4.2 Q0 1.2 3.4 4.2" fill="none" stroke="#141414" stroke-width="1.4" stroke-linecap="round"/>
  </g>`;
}

function faceFor(card) {
  switch (card.type) {
    case "number":
      return { face: `<span class="num">${card.value}</span>`, corner: card.value };
    case "skip":
      return {
        face: svg(`<g fill="none" stroke-linecap="round">
          <circle cx="32" cy="32" r="16" stroke="#141414" stroke-width="10"/>
          <line x1="21" y1="43" x2="43" y2="21" stroke="#141414" stroke-width="10"/>
          <circle cx="32" cy="32" r="16" stroke="#fff" stroke-width="6"/>
          <line x1="21" y1="43" x2="43" y2="21" stroke="#fff" stroke-width="6"/>
        </g>`),
        corner: "⊘",
      };
    case "reverse":
      return {
        face: svg(`<g stroke="#141414" stroke-width="2" stroke-linejoin="round">
          <path d="M20 30c1-9 9-15 18-15h7l-7-9 18 14-18 14 7-9h-7c-5 0-9 3-9 8" fill="#fff"/>
          <path d="M44 34c-1 9-9 15-18 15h-7l7 9-18-14 18-14-7 9h7c5 0 9-3 9-8" fill="#fff"/>
        </g>`),
        corner: "⇄",
      };
    case "draw2":
      return {
        face: svg(`${miniRect(26, 30, -22, "#fff", 18, 28)}${miniRect(38, 34, 14, "#fff", 18, 28)}`),
        corner: "+2",
      };
    case "draw4":
      return {
        face: svg(
          `${miniRect(22, 28, -28, "#fff", 15, 24)}${miniRect(32, 26, -8, "#fff", 15, 24)}${miniRect(34, 36, 10, "#fff", 15, 24)}${miniRect(44, 34, 26, "#fff", 15, 24)}`
        ),
        corner: "+4",
      };
    case "skipEveryone":
      return {
        face: svg(`<g fill="#fff" stroke="#141414" stroke-width="1.6" stroke-linejoin="round">
          <path d="M14 16 L30 32 L14 48 Z"/>
          <path d="M32 16 L48 32 L32 48 Z"/>
        </g>`),
        corner: "⏭",
      };
    case "discardAll":
      return {
        face: svg(
          `${miniRect(22, 34, -28, "#fff", 16, 26)}${miniRect(32, 30, -8, "#fff", 16, 26)}${miniRect(42, 34, 16, "#fff", 16, 26)}`
        ),
        corner: "×",
      };
    case "wildReverseDraw4":
      return {
        face: svg(
          `${miniRect(22, 38, -18, C.g)}${miniRect(44, 24, 12, C.y)}${miniRect(24, 24, -8, C.r)}
           <path d="M18 40 L38 18" stroke="#fff" stroke-width="7" stroke-linecap="round"/>
           <path d="M32 14 L40 22 L28 24 Z" fill="#fff" stroke="#141414" stroke-width="1"/>
           <path d="M46 24 L26 46" stroke="#8fd3ff" stroke-width="7" stroke-linecap="round"/>
           <path d="M22 42 L30 50 L18 48 Z" fill="#8fd3ff" stroke="#141414" stroke-width="1"/>`
        ),
        corner: "⇄4",
      };
    case "wildDraw6":
      return {
        face: svg(
          `${miniRect(22, 36, -30, C.r)}${miniRect(30, 26, -12, C.y)}${miniRect(40, 24, 8, C.g)}${miniRect(46, 34, 22, C.b)}${miniRect(28, 40, 6, C.b)}${miniRect(38, 40, 16, C.r)}`
        ),
        corner: "+6",
      };
    case "wildReverseDraw8":
      return {
        face: svg(
          `${miniRect(20, 36, -26, C.r)}${miniRect(30, 24, -10, C.y)}${miniRect(42, 26, 12, C.g)}${miniRect(46, 38, 24, C.b)}
           <path d="M22 44 Q32 28 46 22" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>
           <path d="M42 46 Q34 36 26 26" fill="none" stroke="#8fd3ff" stroke-width="3.2" stroke-linecap="round"/>`
        ),
        corner: "⇄8",
      };
    case "wildDraw10":
      return {
        face: svg(
          `${miniRect(20, 34, -32, C.r, 12, 18)}${miniRect(28, 24, -18, C.y, 12, 18)}${miniRect(38, 22, -2, C.g, 12, 18)}${miniRect(46, 28, 16, C.b, 12, 18)}${miniRect(48, 38, 28, C.r, 12, 18)}${miniRect(22, 42, -8, C.g, 12, 18)}${miniRect(32, 40, 8, C.b, 12, 18)}${miniRect(40, 42, 18, C.y, 12, 18)}
           <path d="M26 44 Q32 28 44 22" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
           <path d="M38 44 Q34 36 30 28" fill="none" stroke="#8fd3ff" stroke-width="3" stroke-linecap="round"/>`
        ),
        corner: "+10",
      };
    case "wildColorRoulette":
      return {
        face: svg(
          `${sadTile(24, 22, -18, C.y)}${sadTile(42, 24, 16, C.r)}${sadTile(22, 42, -8, C.g)}${sadTile(40, 42, 12, C.b)}${sadTile(32, 32, 4, "#0aa3a0")}`
        ),
        corner: "◎",
      };
    case "wildDiscardAll":
      return {
        face: svg(
          `${miniRect(24, 34, -22, C.r)}${miniRect(32, 24, -4, C.y)}${miniRect(42, 30, 16, C.g)}${miniRect(34, 40, 8, C.b)}`
        ),
        corner: "ALL",
      };
    case "wildFinalAttack":
      return {
        face: svg(`<g>
          <text x="32" y="42" text-anchor="middle" font-size="36" font-family="Anton,sans-serif" fill="#f7d117" stroke="#141414" stroke-width="3">+</text>
          <circle cx="14" cy="18" r="2" fill="#fff"/>
          <circle cx="50" cy="16" r="1.6" fill="#fff"/>
          <circle cx="48" cy="48" r="2" fill="#fff"/>
          <path d="M12 46 L18 40 M46 20 L52 14" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
        </g>`),
        corner: "+",
      };
    case "wildSuddenDeath":
      return {
        face: svg(`<g>
          <path d="M32 12 L36 28 L52 32 L36 36 L32 52 L28 36 L12 32 L28 28 Z" fill="#f7d117" stroke="#141414" stroke-width="1.4"/>
          <circle cx="32" cy="32" r="8" fill="#fff" stroke="#141414" stroke-width="1.5"/>
          <circle cx="32" cy="32" r="4" fill="#1b9a3c"/>
          <circle cx="33.5" cy="30.5" r="1.4" fill="#141414"/>
        </g>`),
        corner: "👁",
      };
    default:
      return { face: "?", corner: "?" };
  }
}

function renderLog(s) {
  const lines = [];
  for (const row of s.log || []) lines.push(`<div>${escapeHtml(row.text)}</div>`);
  for (const row of s.chat || []) {
    lines.push(`<div><b>${escapeHtml(row.name)}:</b> ${escapeHtml(row.text)}</div>`);
  }
  $("log").innerHTML = lines.join("");
  $("log").scrollTop = $("log").scrollHeight;
}

function renderModal(s, me) {
  const modal = $("modal");
  const card = $("modal-card");
  const mine = s.pending?.playerId === s.you;
  if (s.phase === "gameOver") return;
  if (!mine) {
    modal.classList.add("hidden");
    return;
  }
  if (s.phase === "chooseColor") {
    modal.classList.remove("hidden");
    card.innerHTML = `<h3>Pick a color</h3><div class="color-picks">${colorButtons()}</div>`;
    bindColors((color) => socket.emit("chooseColor", { color }));
    return;
  }
  if (s.phase === "chooseRoulette") {
    modal.classList.remove("hidden");
    card.innerHTML = `<h3>Color roulette</h3><p>Choose a color, then reveal cards until you hit it. Wilds don’t count.</p><div class="color-picks">${colorButtons()}</div>`;
    bindColors((color) => socket.emit("chooseRoulette", { color }));
    return;
  }
  if (s.phase === "mercySave") {
    modal.classList.remove("hidden");
    card.innerHTML = `<h3>Mercy?</h3><p>You have 25+ cards. Use your Mercy coin to dump your hand and draw 7, or you're out.</p>
      <div class="lobby-actions">
        <button class="btn primary" id="save-mercy">Use Mercy</button>
        <button class="btn ghost" id="skip-mercy">I'm out</button>
      </div>`;
    $("save-mercy").onclick = () => socket.emit("useCoin");
    $("skip-mercy").onclick = () => socket.emit("declineMercy");
    return;
  }
  if (s.phase === "chooseSwap") {
    modal.classList.remove("hidden");
    const targets = s.players.filter((p) => p.id !== s.you && !p.eliminated);
    card.innerHTML = `<h3>7 — swap hands</h3><div class="swap-picks">${targets
      .map(
        (p) =>
          `<button class="swap-btn" data-id="${p.id}">${escapeHtml(p.name)}<br><small>${p.cardCount} cards</small></button>`
      )
      .join("")}</div>`;
    card.querySelectorAll("[data-id]").forEach((btn) => {
      btn.onclick = () => socket.emit("chooseSwap", { playerId: btn.dataset.id });
    });
    return;
  }
  modal.classList.add("hidden");
}

function colorButtons() {
  return ["red", "yellow", "green", "blue"]
    .map((c) => `<button class="swatch ${c}" data-color="${c}" aria-label="${c}"></button>`)
    .join("");
}
function bindColors(fn) {
  $("modal-card").querySelectorAll("[data-color]").forEach((btn) => {
    btn.onclick = () => fn(btn.dataset.color);
  });
}

function showWinner(s) {
  $("modal").classList.remove("hidden");
  const winner = s.players.find((p) => p.id === s.winnerId);
  const host = s.hostId === s.you;
  $("modal-card").innerHTML = `<div class="winner">
    <h3>${winner ? escapeHtml(winner.name) : "Nobody"} wins</h3>
    <p>${escapeHtml(s.winnerReason || "")}</p>
    ${host ? `<button class="btn primary" id="again">Play again</button>` : `<p>Waiting for host to restart…</p>`}
  </div>`;
  const again = $("again");
  if (again) again.onclick = () => socket.emit("playAgain");
}

function shoutFrom(s, prev) {
  const last = (s.events || []).at(-1);
  if (!last) return;
  const key = `${last.t}-${last.type}`;
  if (key === lastShout) return;
  lastShout = key;
  if (last.type === "uno") shout("UNO!");
  if (last.type === "mercy") shout("NO MERCY", "mercy");
  if (last.type === "win") shout("WINNER");
  if (last.type === "stackHit") shout(`+${last.payload.amount}`);
  if (last.type === "challenge") shout(last.payload.won ? "CHALLENGE WON" : `+${last.payload.drawn}`);
  if (last.type === "finalAttack") shout(last.payload.mega ? "FINAL ATTACK" : "ATTACK");
  if (last.type === "suddenDeath") shout("SUDDEN DEATH");
  if (last.type === "noMercy") shout("NO MERCY", "mercy");
}

function shout(text, cls = "") {
  const el = $("shout");
  el.className = `shout ${cls}`;
  el.textContent = text;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 900);
}

function nameOf(s, id) {
  return s.players.find((p) => p.id === id)?.name || "Player";
}

function toast(message, type = "info") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

if ($("sample-cards")) {
  const samples = [
    { id: "s1", color: "yellow", type: "number", value: 4 },
    { id: "s2", color: "blue", type: "draw2" },
    { id: "s3", color: "green", type: "number", value: 0 },
    { id: "s4", color: "red", type: "number", value: 3 },
    { id: "s5", color: null, type: "wildColorRoulette" },
    { id: "s6", color: null, type: "wildDraw6" },
    { id: "s7", color: null, type: "wildReverseDraw8" },
    { id: "s8", color: null, type: "wildDraw10" },
    { id: "s9", color: null, type: "wildDiscardAll" },
    { id: "s10", color: "red", type: "number", value: 10 },
    { id: "s11", color: null, type: "wildFinalAttack" },
    { id: "s12", color: null, type: "wildSuddenDeath" },
  ];
  $("sample-cards").innerHTML = samples.map((c) => cardEl(c)).join("");
}
