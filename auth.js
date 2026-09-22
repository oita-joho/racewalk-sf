// auth.js
// 競歩システム：認証・当日トークン管理
const crypto = require("crypto");
const firebaseStore = require("./firebase-store");

let tokenCache = null;


// =====================================================
// 設定係パスコード
// =====================================================

function hashPasscode(passcode, salt) {
  return crypto
    .scryptSync(
      String(passcode),
      salt,
      64
    )
    .toString("hex");
}


async function setHostPasscode(passcode) {
  const value =
    String(passcode || "").trim();

  if (value.length < 4) {
    throw new Error(
      "設定係パスコードは4文字以上にしてください"
    );
  }

  const salt =
    crypto.randomBytes(16)
      .toString("hex");

  const hash =
    hashPasscode(value, salt);

  await firebaseStore.saveHostPasscode({
    salt,
    hash,
  });
}


async function verifyHostPasscode(passcode) {
  const saved =
    await firebaseStore.loadHostPasscode();

  // Firebaseへ移行するまでの初回だけ
  // RenderのHOST_PASSCODEを使用する
  if (!saved?.salt || !saved?.hash) {
    const oldPasscode =
      process.env.HOST_PASSCODE || "";

    if (!oldPasscode) {
      return false;
    }

    if (
      String(passcode) !== oldPasscode
    ) {
      return false;
    }

    // 初回ログイン成功時にFirebaseへ移行
    await setHostPasscode(oldPasscode);

    console.log(
      "設定係パスコードをFirebaseへ移行しました"
    );

    return true;
  }

  const inputHash =
    hashPasscode(
      passcode,
      saved.salt
    );

  const a =
    Buffer.from(
      inputHash,
      "hex"
    );

  const b =
    Buffer.from(
      saved.hash,
      "hex"
    );

  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}


// =====================================================
// Token generation
// =====================================================
function makeToken(len = 16) {
  return crypto
    .randomBytes(24)
    .toString("base64url")
    .slice(0, len);
}


function createInitialTokens() {
  return {
    host:
      "rw_HOST_" + makeToken(),

    judge1:
      makeToken(),

    judge2:
      makeToken(),

    judge3:
      makeToken(),

    judge4:
      makeToken(),

    judge5:
      makeToken(),

    chiefjudge:
      makeToken(),

    recorder:
      makeToken(),

    chief:
      makeToken(),
  };
}


// =====================================================
// Firebaseから当日トークンを復元
// =====================================================
async function initializeTokens() {
  const firebaseTokens =
    await firebaseStore.loadTokens();

  if (firebaseTokens) {
    tokenCache = {
      ...firebaseTokens,
    };

    console.log(
      "当日トークンをFirebaseから復元しました"
    );

    return tokenCache;
  }

  // Firebaseにまだトークンがない場合だけ新規作成
  const initialTokens =
    createInitialTokens();

  tokenCache =
    await firebaseStore.saveTokens(
      initialTokens
    );

  console.log(
    "当日トークンをFirebaseへ初回保存しました"
  );

  return tokenCache;
}


// =====================================================
// Token access
// =====================================================
function loadTokens() {
  if (!tokenCache) {
    throw new Error(
      "当日トークンがまだ初期化されていません"
    );
  }

  return tokenCache;
}


async function saveTokens(tokens) {
  tokenCache = {
    ...tokens,
  };

  tokenCache =
    await firebaseStore.saveTokens(
      tokenCache
    );

  return tokenCache;
}


// =====================================================
// Role
// =====================================================
function judgeIdToRole(judgeId) {
  const s =
    String(judgeId || "")
      .trim()
      .toUpperCase();

  if (s === "J1") return "judge1";
  if (s === "J2") return "judge2";
  if (s === "J3") return "judge3";
  if (s === "J4") return "judge4";
  if (s === "J5") return "judge5";

  return null;
}


// =====================================================
// Token authentication
// =====================================================
function tokenOkFor(
  role,
  judgeId,
  token
) {
  // 掲示板は公開
  if (role === "board") {
    return true;
  }

  const t =
    String(token || "").trim();

  if (!t) {
    return false;
  }

  const tokens =
    loadTokens();

  if (role === "host") {
    return tokens.host === t;
  }

  if (role === "judge") {
    const key =
      judgeIdToRole(judgeId);

    return !!(
      key &&
      tokens[key] === t
    );
  }

  if (role === "chiefjudge") {
    return tokens.chiefjudge === t;
  }

  if (role === "recorder") {
    return tokens.recorder === t;
  }

  if (role === "chief") {
    return tokens.chief === t;
  }

  return false;
}


// =====================================================
// Operation permissions
// =====================================================
function requiredRole(op) {
  if (
    op === "LOAD_ROSTER" ||
    op === "SAVE_ROSTER" ||
    op === "CLEAR_ROSTER" ||
    op === "APPLY_GROUP" ||
    op === "GET_TOKENS" ||
    op === "REGEN_TOKEN" ||
    op === "REGEN_ALL_TOKENS"
  ) {
    return ["host"];
  }

  if (
    op === "CONFIRM" ||
    op === "CANCEL"
  ) {
    return ["recorder"];
  }

    // 競技終了は設定係
  if (op === "END_RACE") {
    return ["host"];
  }

  // 記録主任はログ初期化のみ
  if (op === "RESET") {
    return ["chief"];
  }

  if (
    op === "NEW_CAUTION" ||
    op === "NEW_WARNING"
  ) {
    return ["judge"];
  }

  if (op === "NEW_CHIEF") {
    return ["chiefjudge"];
  }

  return null;
}


// =====================================================
// Export
// =====================================================
module.exports = {
  makeToken,

  initializeTokens,
  loadTokens,
  saveTokens,

  setHostPasscode,
  verifyHostPasscode,

  judgeIdToRole,
  tokenOkFor,
  requiredRole,
};
