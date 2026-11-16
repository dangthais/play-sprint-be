// Modified for Quick Playing — xem apps/games/UPSTREAM.md
const word = document.getElementById("word");
const text = document.getElementById("text");
const scoreElement = document.getElementById("score");
const timeElement = document.getElementById("time");
const endgameElement = document.getElementById("end-game-container");

// List of words for game
const words = [
  "sigh",
  "tense",
  "airplane",
  "ball",
  "pies",
  "juice",
  "warlike",
  "bad",
  "north",
  "dependent",
  "steer",
  "silver",
  "highfalutin",
  "superficial",
  "quince",
  "eight",
  "feeble",
  "admit",
  "drag",
  "loving",
];

let randomWord;
let score = 0;
let time = 10;
let gameOverSent = false;
// Modified for Quick Playing: khoá độ khó Medium (+3 s mỗi từ), bỏ localStorage/settings
const difficulty = "medium";

// Đồng hồ chạy ngay khi tải trang
const timeInterval = setInterval(updateTime, 1000);

function getRandomWord() {
  return words[Math.floor(Math.random() * words.length)];
}

function addWordToDom() {
  randomWord = getRandomWord();
  word.innerText = randomWord;
}

function updateScore() {
  score++;
  scoreElement.innerText = score;
  QP.score(score);
}

function updateTime() {
  time--;
  timeElement.innerText = time + "s";
  if (time === 0) {
    clearInterval(timeInterval);
    gameOver();
  }
}

function gameOver() {
  if (gameOverSent) return;
  gameOverSent = true;
  QP.gameOver(score);
  // Modified for Quick Playing: bỏ template innerHTML + onclick="history.go(0)" -> DOM API
  endgameElement.textContent = "";
  const title = document.createElement("h1");
  title.textContent = "Time ran out";
  const result = document.createElement("p");
  result.textContent = "Your final score is " + score;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Play Again";
  button.addEventListener("click", () => location.reload());
  endgameElement.append(title, result, button);
  endgameElement.style.display = "flex";
  button.focus();
}

text.addEventListener("input", (e) => {
  if (gameOverSent) return;
  const insertedText = e.target.value;
  if (insertedText === randomWord) {
    e.target.value = "";
    addWordToDom();
    updateScore();
    if (difficulty === "hard") time += 2;
    else if (difficulty === "medium") time += 3;
    else time += 5;
    updateTime();
  }
});

// Init
addWordToDom();
text.focus();
QP.ready();
