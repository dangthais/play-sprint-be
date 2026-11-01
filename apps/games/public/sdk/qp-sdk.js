/*
 * Quick Playing game SDK, giao thức v1 (xem docs/game-protocol.md).
 * Script cổ điển, không phụ thuộc. Nạp SAU /sdk/config.js và TRƯỚC mã game.
 * Game không bao giờ gọi API hay giữ token; SDK chỉ gửi message cho host.
 */
(function () {
  'use strict';

  var PROTOCOL_VERSION = 1;
  var MAX_SCORE = 1000000000;

  // Chỉ chấp nhận hostOrigin là origin http(s) ở dạng chuẩn hoá (không path/query).
  function readHostOrigin() {
    try {
      var cfg = self.QP_CONFIG;
      if (!cfg || typeof cfg.hostOrigin !== 'string') return null;
      var url = new URL(cfg.hostOrigin);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      if (url.origin !== cfg.hostOrigin) return null;
      return url.origin;
    } catch {
      return null;
    }
  }

  var hostOrigin = null;
  var active = false;
  try {
    hostOrigin = readHostOrigin();
    active = window.parent !== window && hostOrigin !== null;
  } catch {
    active = false;
  }

  function warn(text) {
    try {
      console.warn('[QP] ' + text);
    } catch {
      /* bỏ qua */
    }
  }

  function post(message) {
    if (!active) return;
    try {
      // targetOrigin cụ thể: trình duyệt tự huỷ message nếu parent không đúng hostOrigin.
      window.parent.postMessage(message, hostOrigin);
    } catch {
      /* không bao giờ throw ra mã game */
    }
  }

  function isValidScore(n) {
    return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= MAX_SCORE;
  }

  function ready() {
    post({ qp: PROTOCOL_VERSION, type: 'ready' });
  }

  function score(n) {
    if (!isValidScore(n)) {
      warn('score bị bỏ qua: cần số nguyên trong khoảng 0..' + MAX_SCORE);
      return;
    }
    post({ qp: PROTOCOL_VERSION, type: 'score', score: n });
  }

  function gameOver(n) {
    if (!isValidScore(n)) {
      warn('gameOver bị bỏ qua: cần số nguyên trong khoảng 0..' + MAX_SCORE);
      return;
    }
    post({ qp: PROTOCOL_VERSION, type: 'gameOver', score: n });
  }

  window.QP = Object.freeze({
    version: PROTOCOL_VERSION,
    ready: ready,
    score: score,
    gameOver: gameOver,
  });
})();
