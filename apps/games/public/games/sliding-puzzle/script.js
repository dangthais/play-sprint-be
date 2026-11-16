// Modified for Quick Playing — xem apps/games/UPSTREAM.md
(function () {
  "use strict";

  // Modified for Quick Playing: khoá độ khó Easy (3x3), bỏ ảnh picsum -> ô hiển thị số
  const SIZE = 3;
  const SHUFFLE_MOVES = 300;

  let state = {
    size: SIZE,
    grid: [],
    emptyIndex: 0,
    moves: 0,
    solved: false,
  };

  const $ = (sel, el = document) => el.querySelector(sel);

  function getNeighbors(index, size) {
    const n = size;
    const row = Math.floor(index / n);
    const col = index % n;
    const neighbors = [];
    if (row > 0) neighbors.push(index - n);
    if (row < n - 1) neighbors.push(index + n);
    if (col > 0) neighbors.push(index - 1);
    if (col < n - 1) neighbors.push(index + 1);
    return neighbors;
  }

  function isSolved(grid) {
    const n = grid.length;
    for (let i = 0; i < n - 1; i++) {
      if (grid[i] !== i + 1) return false;
    }
    return grid[n - 1] === 0;
  }

  // Modified for Quick Playing: chỉ nhận bàn có khoảng cách giải tối ưu >= MIN_SOLVE_DEPTH (18 nước),
  // để người chơi không bấm New Game liên tục tới khi gặp bàn gần đích. BFS từ trạng thái đích
  // (chỉ tới độ sâu 17, ~17 400 trạng thái, tính một lần khi tải trang) -> tập "bàn quá dễ".
  const MIN_SOLVE_DEPTH = 18;
  const NEIGHBORS_3X3 = [[1, 3], [0, 2, 4], [1, 5], [0, 4, 6], [1, 3, 5, 7], [2, 4, 8], [3, 7], [4, 6, 8], [5, 7]];
  let easyBoards = null;

  function buildEasyBoards() {
    const goal = "123456780";
    const seen = new Set([goal]);
    let frontier = [goal];
    for (let depth = 1; depth < MIN_SOLVE_DEPTH && frontier.length > 0; depth++) {
      const next = [];
      for (const key of frontier) {
        const empty = key.indexOf("0");
        for (const nb of NEIGHBORS_3X3[empty]) {
          const cells = key.split("");
          cells[empty] = cells[nb];
          cells[nb] = "0";
          const nextKey = cells.join("");
          if (!seen.has(nextKey)) {
            seen.add(nextKey);
            next.push(nextKey);
          }
        }
      }
      frontier = next;
    }
    return seen;
  }

  function createSolvablePuzzle(size) {
    if (size === 3 && easyBoards === null) easyBoards = buildEasyBoards();
    const n = size * size;
    let grid;
    let emptyIndex;
    do {
      grid = [];
      for (let i = 1; i < n; i++) grid.push(i);
      grid.push(0);
      emptyIndex = n - 1;
      for (let i = 0; i < SHUFFLE_MOVES; i++) {
        const neighbors = getNeighbors(emptyIndex, size);
        const next = neighbors[Math.floor(Math.random() * neighbors.length)];
        [grid[emptyIndex], grid[next]] = [grid[next], grid[emptyIndex]];
        emptyIndex = next;
      }
    } while (isSolved(grid) || (easyBoards !== null && easyBoards.has(grid.join("")))); // không bắt đầu bằng bàn đã giải hoặc quá dễ
    return { grid, emptyIndex };
  }

  function startNewGame() {
    state.size = SIZE;
    const { grid, emptyIndex } = createSolvablePuzzle(state.size);
    state.grid = grid;
    state.emptyIndex = emptyIndex;
    state.moves = 0;
    state.solved = false;
    render();
    $("#winOverlay").classList.add("hidden");
  }

  // Ván mới do người chơi bấm (New Game / Play Again) -> host tạo phiên mới
  function restartGame() {
    startNewGame();
    QP.ready();
  }

  function isAdjacentToEmpty(index) {
    return getNeighbors(state.emptyIndex, state.size).includes(index);
  }

  function moveTile(index) {
    if (state.solved || !isAdjacentToEmpty(index)) return;
    const empty = state.emptyIndex;
    [state.grid[empty], state.grid[index]] = [state.grid[index], state.grid[empty]];
    state.emptyIndex = index;
    state.moves += 1;
    render();
    QP.score(state.moves);
    if (isSolved(state.grid)) {
      state.solved = true;
      QP.gameOver(state.moves);
      $("#winMoves").textContent = "Moves: " + state.moves;
      $("#winOverlay").classList.remove("hidden");
    }
  }

  function render() {
    const board = $("#board");
    const size = state.size;
    board.className = "board size-" + size;
    board.textContent = "";
    const n = size * size;
    for (let i = 0; i < n; i++) {
      const value = state.grid[i];
      const tile = document.createElement("div");
      tile.className = "tile" + (value === 0 ? " empty" : "");
      tile.dataset.index = i;
      tile.setAttribute("role", "gridcell");
      if (value !== 0) {
        tile.textContent = String(value);
        tile.addEventListener("click", () => moveTile(i));
      }
      board.appendChild(tile);
    }
    $("#moves").textContent = "Moves: " + state.moves;
  }

  function showHelp() {
    $("#helpOverlay").classList.remove("hidden");
    $("#helpOverlay").setAttribute("aria-hidden", "false");
  }

  function hideHelp() {
    $("#helpOverlay").classList.add("hidden");
    $("#helpOverlay").setAttribute("aria-hidden", "true");
  }

  function init() {
    $("#newGameBtn").addEventListener("click", restartGame);
    $("#playAgainBtn").addEventListener("click", restartGame);
    $("#helpBtnGame").addEventListener("click", showHelp);
    $("#helpClose").addEventListener("click", hideHelp);
    $("#helpOverlay").addEventListener("click", (e) => {
      if (e.target.id === "helpOverlay") hideHelp();
    });
    startNewGame();
    QP.ready();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
