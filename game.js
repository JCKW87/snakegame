(function () {
  "use strict";

  const COLS = 24;
  const ROWS = 24;
  const BASE_MS = 180;
  const MIN_MS = 55;
  const SPEED_STEP_MS = 8;
  const SPEED_EVERY_N_LENGTH = 2;
  const TARGET_OBSTACLES = 36;
  const OBSTACLE_PLACE_ATTEMPTS = 2500;
  const LB_KEY = "snake-leaderboard-v1";
  const LB_MAX_ENTRIES = 3;
  const LB_MIN_SCORE = 10;
  const LB_MAX_NAME_LEN = 5;

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const lengthEl = document.getElementById("length");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayMsg = document.getElementById("overlay-msg");
  const startBtn = document.getElementById("start-btn");
  const restartBtn = document.getElementById("restart");
  const gameOverForm = document.getElementById("game-over-form");
  const lbNameInput = document.getElementById("lb-name");
  const lbSaveBtn = document.getElementById("lb-save");
  const lbSaveStatus = document.getElementById("lb-save-status");
  const leaderboardList = document.getElementById("leaderboard-list");

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
  let awaitingStart;
  let pendingLeaderboardScore;
  let scoreSavedThisRun;

  function isLeaderboardFieldFocused() {
    const el = document.activeElement;
    return el === lbNameInput;
  }

  function loadLeaderboardRaw() {
    try {
      const raw = localStorage.getItem(LB_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (e) =>
          e &&
          typeof e.name === "string" &&
          typeof e.score === "number" &&
          Number.isFinite(e.score)
      );
    } catch {
      return [];
    }
  }

  function normalizeLeaderboardList(list) {
    return list
      .filter((e) => e.score >= LB_MIN_SCORE)
      .sort((a, b) => b.score - a.score || b.at - a.at)
      .slice(0, LB_MAX_ENTRIES);
  }

  function loadLeaderboard() {
    return normalizeLeaderboardList(loadLeaderboardRaw());
  }

  function saveLeaderboardEntry(name, gameScore) {
    if (!Number.isFinite(gameScore) || gameScore < LB_MIN_SCORE) return false;
    const trimmed = name.trim().slice(0, LB_MAX_NAME_LEN);
    if (trimmed.length === 0) return false;
    const merged = loadLeaderboardRaw().concat({
      name: trimmed,
      score: gameScore,
      at: Date.now(),
    });
    const next = normalizeLeaderboardList(merged);
    localStorage.setItem(LB_KEY, JSON.stringify(next));
    renderLeaderboard();
    return true;
  }

  function renderLeaderboard() {
    leaderboardList.replaceChildren();
    const entries = loadLeaderboard();
    if (entries.length === 0) {
      const li = document.createElement("li");
      li.className = "lb-empty";
      li.textContent = `No top scores yet — score ${LB_MIN_SCORE}+ and save after game over.`;
      leaderboardList.appendChild(li);
      return;
    }
    entries.forEach((entry, i) => {
      const li = document.createElement("li");
      const rank = document.createElement("span");
      rank.className = "lb-rank";
      rank.textContent = `${i + 1}.`;
      const nameSpan = document.createElement("span");
      nameSpan.className = "lb-name";
      nameSpan.textContent = entry.name;
      const scoreSpan = document.createElement("span");
      scoreSpan.className = "lb-score";
      scoreSpan.textContent = String(entry.score);
      li.append(rank, nameSpan, scoreSpan);
      leaderboardList.appendChild(li);
    });
  }

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
    if (awaitingStart || gameOver || paused) return;
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
    const cx = Math.floor(COLS / 2);
    const cy = Math.floor(ROWS / 2);

    function canPlace(x, y) {
      if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return false;
      if (Math.abs(x - cx) <= 3 && Math.abs(y - cy) <= 2) return false;
      const k = `${x},${y}`;
      if (used.has(k)) return false;
      return true;
    }

    let attempts = 0;
    while (list.length < TARGET_OBSTACLES && attempts < OBSTACLE_PLACE_ATTEMPTS) {
      attempts++;
      const x = Math.floor(Math.random() * COLS);
      const y = Math.floor(Math.random() * ROWS);
      if (!canPlace(x, y)) continue;
      used.add(`${x},${y}`);
      list.push({ x, y });
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

  function showStartOverlay() {
    overlayTitle.textContent = "Ready?";
    overlayMsg.textContent =
      "Green snake, gold fruit, red dots. Press Start when you’re ready.";
    gameOverForm.hidden = true;
    startBtn.hidden = false;
    restartBtn.hidden = true;
    overlay.classList.remove("hidden");
    startBtn.focus();
  }

  function showGameOverOverlay(title, msg) {
    overlayTitle.textContent = title;
    const canSave = pendingLeaderboardScore >= LB_MIN_SCORE;
    overlayMsg.textContent = canSave
      ? msg
      : `${msg} You need at least ${LB_MIN_SCORE} points to save to the top ${LB_MAX_ENTRIES}.`;
    gameOverForm.hidden = !canSave;
    if (canSave) {
      lbNameInput.value = "";
      lbSaveStatus.hidden = true;
      lbSaveStatus.textContent = "";
      lbSaveStatus.classList.remove("is-error");
      lbSaveBtn.disabled = false;
      scoreSavedThisRun = false;
    }
    startBtn.hidden = true;
    restartBtn.hidden = false;
    overlay.classList.remove("hidden");
    if (canSave) lbNameInput.focus();
    else restartBtn.focus();
  }

  function hideOverlay() {
    overlay.classList.add("hidden");
  }

  function beginGame() {
    if (!awaitingStart || gameOver) return;
    awaitingStart = false;
    hideOverlay();
    scheduleTick();
  }

  function scheduleTick() {
    if (timer) clearInterval(timer);
    if (awaitingStart || gameOver || paused) return;
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
    awaitingStart = false;
    pendingLeaderboardScore = score;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    showGameOverOverlay(title, msg);
    draw();
  }

  function drawCellCircle(gx, gy, radiusFrac, fillStyle) {
    const cw = cellW();
    const ch = cellH();
    const px = gx * cw + cw / 2;
    const py = gy * ch + ch / 2;
    const r = (Math.min(cw, ch) / 2) * radiusFrac;
    ctx.fillStyle = fillStyle;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function draw() {
    const cw = cellW();
    const ch = cellH();

    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--panel").trim() || "#15251c";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const gridColor = getComputedStyle(document.documentElement).getPropertyValue("--grid").trim() || "#1e3d2a";
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

    const obstacleColor =
      getComputedStyle(document.documentElement).getPropertyValue("--obstacle").trim() || "#ef4444";
    for (const o of obstacles) {
      drawCellCircle(o.x, o.y, 0.42, obstacleColor);
    }

    if (food) {
      const foodColor =
        getComputedStyle(document.documentElement).getPropertyValue("--food").trim() || "#e6c04a";
      drawCellCircle(food.x, food.y, 0.38, foodColor);
    }

    const snakeColor =
      getComputedStyle(document.documentElement).getPropertyValue("--snake").trim() || "#22c55e";
    const headColor =
      getComputedStyle(document.documentElement).getPropertyValue("--snake-head").trim() || "#86efac";
    for (let i = snake.length - 1; i >= 0; i--) {
      const s = snake[i];
      const c = i === 0 ? headColor : snakeColor;
      const frac = i === 0 ? 0.46 : 0.4;
      drawCellCircle(s.x, s.y, frac, c);
    }

    if (paused && !gameOver) {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#e8f5ec";
      ctx.font = "600 22px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Paused", canvas.width / 2, canvas.height / 2);
    }
  }

  function init() {
    renderLeaderboard();

    if (timer) {
      clearInterval(timer);
      timer = null;
    }

    awaitingStart = true;
    gameOver = false;
    paused = false;

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

    if (!food) {
      awaitingStart = false;
      gameOver = true;
      overlayTitle.textContent = "Error";
      overlayMsg.textContent = "Could not place food.";
      gameOverForm.hidden = true;
      startBtn.hidden = true;
      restartBtn.hidden = false;
      overlay.classList.remove("hidden");
      restartBtn.focus();
      draw();
      return;
    }

    showStartOverlay();
    draw();
  }

  window.addEventListener("keydown", (e) => {
    if (isLeaderboardFieldFocused()) return;

    if (e.code === "Space") {
      e.preventDefault();
      if (awaitingStart || gameOver) return;
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
      if (awaitingStart || gameOver || paused) return;
      const dx = Number(btn.dataset.dx);
      const dy = Number(btn.dataset.dy);
      if (Number.isNaN(dx) || Number.isNaN(dy)) return;
      trySetDir({ x: dx, y: dy });
    });
  });

  startBtn.addEventListener("click", () => beginGame());

  restartBtn.addEventListener("click", () => init());

  function submitLeaderboardScore() {
    if (scoreSavedThisRun) return;
    if (pendingLeaderboardScore < LB_MIN_SCORE) return;
    const raw = lbNameInput.value.trim();
    if (raw.length === 0) {
      lbSaveStatus.hidden = false;
      lbSaveStatus.classList.add("is-error");
      lbSaveStatus.textContent = "Enter 1–5 characters for your name.";
      return;
    }
    const name = raw.slice(0, LB_MAX_NAME_LEN);
    const ok = saveLeaderboardEntry(name, pendingLeaderboardScore);
    if (!ok) return;
    scoreSavedThisRun = true;
    lbSaveStatus.hidden = false;
    lbSaveStatus.classList.remove("is-error");
    lbSaveStatus.textContent = "Saved to leaderboard.";
    lbSaveBtn.disabled = true;
  }

  lbSaveBtn.addEventListener("click", () => submitLeaderboardScore());

  lbNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitLeaderboardScore();
    }
  });

  init();
})();
