(function () {
  "use strict";

  const COLS = 24;
  const ROWS = 24;
  const BASE_MS = 180;
  const MIN_MS = 55;
  const SPEED_STEP_MS = 8;
  const SPEED_EVERY_N_LENGTH = 2;

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const lengthEl = document.getElementById("length");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayMsg = document.getElementById("overlay-msg");
  const restartBtn = document.getElementById("restart");

  const cellW = () => canvas.width / COLS;
  const cellH = () => canvas.height / ROWS;

  let snake;
  let dir;
  let nextDir;
  let food;
  let obstacles;
  let score;
  let tickMs;
  let timer;
  let paused;
  let gameOver;

  function keyToDir(key) {
    const map = {
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
    };
    return map[key] ?? null;
  }

  function trySetDir(d) {
    if (gameOver || paused) return;
    nextDir = d;
  }

  function opposite(a, b) {
    return a.x === -b.x && a.y === -b.y;
  }

  function obstacleSet() {
    const set = new Set();
    for (const o of obstacles) set.add(`${o.x},${o.y}`);
    return set;
  }

  function buildObstacles() {
    const list = [];
    const used = new Set();
    const center = { x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2) };

    function add(x, y) {
      const k = `${x},${y}`;
      if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return;
      if (Math.abs(x - center.x) <= 1 && Math.abs(y - center.y) <= 1) return;
      if (used.has(k)) return;
      used.add(k);
      list.push({ x, y });
    }

    // Border pillars (sparse) + inner blocks
    for (let i = 3; i < COLS - 3; i += 4) {
      add(i, 2);
      add(i, ROWS - 3);
    }
    for (let j = 4; j < ROWS - 4; j += 5) {
      add(2, j);
      add(COLS - 3, j);
    }
    // Cross in the middle (with gap for movement)
    const midX = Math.floor(COLS / 2);
    const midY = Math.floor(ROWS / 2);
    for (let d = 4; d <= 7; d++) {
      add(midX - d, midY);
      add(midX + d, midY);
      add(midX, midY - d);
      add(midX, midY + d);
    }
    // Random scatter
    let tries = 0;
    while (list.length < 42 && tries < 400) {
      tries++;
      add(Math.floor(Math.random() * COLS), Math.floor(Math.random() * ROWS));
    }
    return list;
  }

  function tickSpeedForLength(len) {
    const tiers = Math.floor((len - 1) / SPEED_EVERY_N_LENGTH);
    return Math.max(MIN_MS, BASE_MS - tiers * SPEED_STEP_MS);
  }

  function placeFood() {
    const obs = obstacleSet();
    const body = new Set(snake.map((s) => `${s.x},${s.y}`));
    const candidates = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const k = `${x},${y}`;
        if (!obs.has(k) && !body.has(k)) candidates.push({ x, y });
      }
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function showOverlay(title, msg) {
    overlayTitle.textContent = title;
    overlayMsg.textContent = msg;
    overlay.classList.remove("hidden");
  }

  function hideOverlay() {
    overlay.classList.add("hidden");
  }

  function scheduleTick() {
    if (timer) clearInterval(timer);
    if (gameOver || paused) return;
    timer = setInterval(tick, tickMs);
  }

  function setTickMsFromLength() {
    tickMs = tickSpeedForLength(snake.length);
    scheduleTick();
  }

  function tick() {
    const nd = nextDir;
    if (!opposite(nd, dir)) dir = nd;

    const head = snake[0];
    const next = { x: head.x + dir.x, y: head.y + dir.y };

    if (next.x < 0 || next.x >= COLS || next.y < 0 || next.y >= ROWS) {
      endGame("Wall", "You hit the edge of the board.");
      return;
    }

    const obs = obstacleSet();
    if (obs.has(`${next.x},${next.y}`)) {
      endGame("Obstacle", "You ran into an obstacle.");
      return;
    }

    const willEat = food && next.x === food.x && next.y === food.y;
    for (let i = 0; i < snake.length; i++) {
      const seg = snake[i];
      if (seg.x !== next.x || seg.y !== next.y) continue;
      const isTail = i === snake.length - 1;
      if (!willEat && isTail) continue;
      endGame("Self", "You collided with your own tail.");
      return;
    }

    snake.unshift(next);

    if (willEat) {
      score += 1;
      scoreEl.textContent = String(score);
      food = placeFood();
      if (!food) {
        endGame("Cleared", "No space left — you win!");
        return;
      }
      setTickMsFromLength();
    } else {
      snake.pop();
    }

    lengthEl.textContent = String(snake.length);
    draw();
  }

  function endGame(title, msg) {
    gameOver = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    showOverlay(title, msg);
    draw();
  }

  function draw() {
    const cw = cellW();
    const ch = cellH();

    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--panel").trim() || "#1a2332";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const gridColor = getComputedStyle(document.documentElement).getPropertyValue("--grid").trim() || "#21262d";
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) {
      ctx.beginPath();
      ctx.moveTo(x * cw, 0);
      ctx.lineTo(x * cw, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * ch);
      ctx.lineTo(canvas.width, y * ch);
      ctx.stroke();
    }

    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--obstacle").trim() || "#f85149";
    for (const o of obstacles) {
      ctx.fillRect(o.x * cw + 1, o.y * ch + 1, cw - 2, ch - 2);
    }

    if (food) {
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--food").trim() || "#f0883e";
      const pad = 3;
      ctx.fillRect(food.x * cw + pad, food.y * ch + pad, cw - pad * 2, ch - pad * 2);
    }

    const snakeColor = getComputedStyle(document.documentElement).getPropertyValue("--snake").trim() || "#58a6ff";
    const headColor = getComputedStyle(document.documentElement).getPropertyValue("--snake-head").trim() || "#79c0ff";
    for (let i = snake.length - 1; i >= 0; i--) {
      const s = snake[i];
      ctx.fillStyle = i === 0 ? headColor : snakeColor;
      const inset = i === 0 ? 2 : 3;
      ctx.fillRect(s.x * cw + inset, s.y * ch + inset, cw - inset * 2, ch - inset * 2);
    }

    if (paused && !gameOver) {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#e6edf3";
      ctx.font = "600 22px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Paused", canvas.width / 2, canvas.height / 2);
    }
  }

  function init() {
    hideOverlay();
    if (timer) {
      clearInterval(timer);
      timer = null;
    }

    const startX = Math.floor(COLS / 2);
    const startY = Math.floor(ROWS / 2);
    snake = [
      { x: startX, y: startY },
      { x: startX - 1, y: startY },
      { x: startX - 2, y: startY },
    ];
    dir = { x: 1, y: 0 };
    nextDir = dir;
    obstacles = buildObstacles();
    score = 0;
    scoreEl.textContent = "0";
    lengthEl.textContent = String(snake.length);
    food = placeFood();
    tickMs = tickSpeedForLength(snake.length);
    paused = false;
    gameOver = false;

    if (!food) {
      showOverlay("Error", "Could not place food.");
      return;
    }

    scheduleTick();
    draw();
  }

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      if (gameOver) return;
      paused = !paused;
      if (paused) {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      } else {
        scheduleTick();
      }
      draw();
      return;
    }

    const d = keyToDir(e.key);
    if (!d) return;
    e.preventDefault();
    trySetDir(d);
  });

  document.querySelectorAll(".dpad-btn").forEach((btn) => {
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const dx = Number(btn.dataset.dx);
      const dy = Number(btn.dataset.dy);
      if (Number.isNaN(dx) || Number.isNaN(dy)) return;
      trySetDir({ x: dx, y: dy });
    });
  });

  restartBtn.addEventListener("click", () => init());

  init();
})();
