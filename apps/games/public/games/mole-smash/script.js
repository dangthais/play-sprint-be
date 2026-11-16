// Modified for Quick Playing — xem apps/games/UPSTREAM.md
const holes = document.querySelectorAll(".hole");
const scoreBoard = document.querySelector(".score");
const moles = document.querySelectorAll(".mole");
const button = document.querySelector("#start");
let lastHole;
let timeUp = true;
let playing = false;
let hasPlayed = false;
let round = 0;
let score = 0;

function randomTime(min, max) {
  return Math.round(Math.random() * (max - min) + min);
}

function randomHole(holes) {
  const idx = Math.floor(Math.random() * holes.length);
  const hole = holes[idx];

  if (hole === lastHole) {
    return randomHole(holes);
  }

  lastHole = hole;
  return hole;
}

function peep(currentRound) {
  const time = randomTime(200, 1000);
  const hole = randomHole(holes);
  hole.classList.add("up");
  setTimeout(() => {
    hole.classList.remove("up");
    if (!timeUp && currentRound === round) peep(currentRound);
  }, time);
}

function startGame() {
  if (playing) return;
  // Ván mới sau khi ván trước đã kết thúc -> host tạo phiên mới (lần Start đầu không gọi lại ready)
  if (hasPlayed) QP.ready();
  hasPlayed = true;
  playing = true;
  round++;
  const currentRound = round;
  scoreBoard.textContent = 0;
  timeUp = false;
  score = 0;
  QP.score(0);
  button.style.visibility = "hidden";
  peep(currentRound);
  setTimeout(() => {
    if (currentRound !== round) return;
    timeUp = true;
    playing = false;
    button.textContent = "Try again?";
    button.style.visibility = "visible";
    QP.gameOver(score);
  }, 10000);
}

function bonk(e) {
  if (!e.isTrusted) return;
  // Chỉ tính khi đang chơi, chưa hết giờ và chuột đang trồi lên (tránh tính 2 lần lúc đang lặn)
  const hole = this.parentElement;
  if (!playing || timeUp || !hole.classList.contains("up")) return;
  score++;
  hole.classList.remove("up");
  scoreBoard.textContent = score;
  QP.score(score);
}

button.addEventListener("click", startGame);
moles.forEach((mole) => mole.addEventListener("click", bonk));
QP.ready();
