// server.js  (20260920)
// Node: express + ws
// Run: node server.js

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const firebaseStore = require("./firebase-store");
const raceState = require("./race-state");

const {
  state,
  safeGroup,
  nextId,
  keyOf,
  lockKey,
  ensureLaneRegistered,
  resetLogKeepRoster,
  initializeRuntime,
} = raceState;
// =====================================================
// Firebase Store
// =====================================================
const {
  getFirebaseDb,
  saveTokens: saveTokensToFirebase,
  loadTokens: loadTokensFromFirebase,
  saveRuntime: saveRuntimeToFirebase,
  loadRuntime: loadRuntimeFromFirebase,
  saveRecord: saveRecordToFirebase,
  loadRecords: loadRecordsFromFirebase,
} = firebaseStore;


// 当日トークンは通常メモリから使用する。
// 更新時とRender再起動時だけFirebaseと同期する。
let tokenCache = null;
async function initializeTokens() {
  const firebaseTokens =
    await loadTokensFromFirebase();

  if (firebaseTokens) {
    tokenCache = firebaseTokens;

    console.log(
      "当日トークンをFirebaseから復元しました"
    );

    return tokenCache;
  }

  // Firebaseにトークンがない場合だけ
  // 旧tokens.jsonから初回移行
  const initialTokens =
    loadTokensFromLocalFile();

  tokenCache =
    await saveTokensToFirebase(initialTokens);

  console.log(
    "当日トークンをFirebaseへ初回保存しました"
  );

  return tokenCache;
}
// =====================================================
// Config / Files
// =====================================================
const PORT = process.env.PORT || 8080;
const HOST_PASSCODE = process.env.HOST_PASSCODE || "";
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || "";
const DATA_DIR = path.join(__dirname, "data");
const ROSTER_FILE = (g) => path.join(DATA_DIR, `roster_g${g}.json`);
const TOKENS_FILE = path.join(DATA_DIR, "tokens.json");
let adminToken = "";

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// host だけ固定
const FIXED_TOKENS = {
  host: "rw_HOST_z8T1mV6qK3c9",
};

// =====================================================
// Utilities
// =====================================================


function isHalfWidthDigits(s) {
  return /^\d+$/.test(String(s ?? "").trim());
}

function hhmmNow() {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const hh = parts.find((p) => p.type === "hour")?.value || "00";
  const mm = parts.find((p) => p.type === "minute")?.value || "00";

  return `${hh}:${mm}`;
}

function localIPv4Candidates() {
  const ifs = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(ifs)) {
    for (const x of ifs[name] || []) {
      if (x.family === "IPv4" && !x.internal) out.push(x.address);
    }
  }
  return out;
}

function makeToken(len = 16) {
  return crypto.randomBytes(24).toString("base64url").slice(0, len);
}

function defaultTokens() {
  return {
    host: "rw_HOST_" + makeToken(),
    judge1: "rw_J1_7fK2mQpL8x",
    judge2: "rw_J2_B4nYt3Qa9v",
    judge3: "rw_J3_U8dLp2Zc5k",
    judge4: "rw_J4_H6xNm1Tr7s",
    judge5: "rw_J5_W9qAz4Mv2e",

    chiefjudge: "rw_CJ_X5pLm8Qr2n",
    recorder: "rw_REC_K7tVb3Yp6m",
    chief: "rw_CHIEF_R4xQn9Td1c",
  };
}

function mergeWithDefaults(obj) {
  return {
    ...defaultTokens(),
    ...(obj && typeof obj === "object" ? obj : {}),
  };
}

// =====================================================
// Token auth (tokens.json)
// host は固定、他は保存型
// =====================================================
// -----------------------------------------------------
// 旧tokens.json読込
// Firebaseへの初回移行時だけ使用
// -----------------------------------------------------
function loadTokensFromLocalFile() {

  if (!fs.existsSync(TOKENS_FILE)) {
    return defaultTokens();
  }

  try {
    const v =
      JSON.parse(
        fs.readFileSync(
          TOKENS_FILE,
          "utf8"
        )
      );

    return mergeWithDefaults(v);

  } catch {
    return defaultTokens();
  }
}


// -----------------------------------------------------
// 現在のトークン取得
// 通常処理はメモリキャッシュを使用
// -----------------------------------------------------
function loadTokens() {

  if (tokenCache) {
    return tokenCache;
  }

  // Firebase初期化前だけの安全策
  return loadTokensFromLocalFile();
}


// -----------------------------------------------------
// トークン更新
// メモリ + Firebase
// -----------------------------------------------------
async function saveTokens(tokens) {

  tokenCache = {
    ...tokens
  };

  await saveTokensToFirebase(
    tokenCache
  );

  return tokenCache;
}

function judgeIdToRole(judgeId) {
  const s = String(judgeId || "").trim().toUpperCase();
  if (s === "J1") return "judge1";
  if (s === "J2") return "judge2";
  if (s === "J3") return "judge3";
  if (s === "J4") return "judge4";
  if (s === "J5") return "judge5";
  return null;
}

function tokenOkFor(role, judgeId, token) {
  if (role === "board") return true; // board は公開のまま

  const t = String(token || "").trim();
  if (!t) return false;

const tokens = loadTokens();

if (role === "host") {
  return tokens.host === t;
}

  if (role === "judge") {
    const key = judgeIdToRole(judgeId);
    return !!(key && tokens[key] === t);
  }

  if (role === "chiefjudge") return tokens.chiefjudge === t;
  if (role === "recorder") return tokens.recorder === t;
  if (role === "chief") return tokens.chief === t;

  return false;
}

function requiredRole(op) {
  if (
    op === "LOAD_ROSTER" ||
    op === "SAVE_ROSTER" ||
    op === "CLEAR_ROSTER" ||
    op === "APPLY_GROUP" ||
    op === "GET_TOKENS" ||
    op === "REGEN_TOKEN" ||
    op === "REGEN_ALL_TOKENS"
  ) return ["host"];

  if (op === "CONFIRM" || op === "CANCEL") return ["recorder"];
  if (op === "END_RACE" || op === "RESET") return ["chief"];
  if (op === "NEW_CAUTION" || op === "NEW_WARNING") return ["judge"];
  if (op === "NEW_CHIEF") return ["chiefjudge"];
  return null;
}

// =====================================================
// Roster IO
// =====================================================
function readRoster(group) {
  const f = ROSTER_FILE(group);
  if (!fs.existsSync(f)) return [];
  try {
    const v = JSON.parse(fs.readFileSync(f, "utf8"));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeRoster(group, roster) {
  const f = ROSTER_FILE(group);
  fs.writeFileSync(f, JSON.stringify(roster, null, 2), "utf8");
}



function applyGroup(group) {
  const g =
    safeGroup(group);

  const roster =
    readRoster(g);

  raceState.applyGroup(
    g,
    roster
  );
}


// =====================================================
// WebSocket helpers
// =====================================================
function send(ws, obj) {
  try {
    ws.send(JSON.stringify(obj));
  } catch {}
}

function reject(ws, reason) {
  send(ws, { op: "REJECT", reason });
}

function broadcast(obj) {
  const text = JSON.stringify(obj);
  for (const ws of [...state.clients]) {
    try {
      ws.send(text);
    } catch {
      state.clients.delete(ws);
    }
  }
}

function snapshotFor(role, judgeId) {
  let items = Object.values(state.byId);

  if (role === "board") {
    items = items.filter(
      (x) =>
        x.status === "confirmed" &&
        (x.level === "warning" || x.level === "dsq1" || x.level === "dsq2")
    );
  } else if (role === "judge" && judgeId) {
    items = items.filter((x) => x.judgeId === judgeId);
  } else if (role === "chief") {
    items = items.filter(
      (x) =>
        x.level === "warning" &&
        (x.status === "pending" || x.status === "confirmed")
    );
  }

  items.sort((a, b) => (b.tsMs || 0) - (a.tsMs || 0));

  return {
    op: "SNAPSHOT",
    raceId: state.raceId,
    currentGroup: state.currentGroup,
    raceActive: state.raceActive,
    roster: Object.values(state.rosterByLane),
    items,
  };
}

// =====================================================
// Server setup (HTTP + WS)
// =====================================================
const app = express();
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/api/time", (req, res) => {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const hh = parts.find((p) => p.type === "hour")?.value || "00";
  const mm = parts.find((p) => p.type === "minute")?.value || "00";
  const ss = parts.find((p) => p.type === "second")?.value || "00";

  res.json({
    hhmm: `${hh}:${mm}`,
    hhmmss: `${hh}:${mm}:${ss}`,
    ts: now.getTime(),
  });
});
// =====================================================
// 設定係 パスコード認証
// =====================================================
app.use(express.json());

app.post("/api/host-login", (req, res) => {
  const passcode = String(req.body?.passcode || "");

  if (!HOST_PASSCODE) {
    return res.status(500).json({
      success: false,
      message: "設定係パスコードがサーバーに設定されていません"
    });
  }

  if (passcode !== HOST_PASSCODE) {
    return res.status(401).json({
      success: false,
      message: "パスコードが違います"
    });
  }

  const tokens = loadTokens();

return res.json({
  success: true,
  token: tokens.host
});
});
// =====================================================
// 設定係：Firebase 保存済み大会一覧
// =====================================================
app.post("/api/host/firebase-events", async (req, res) => {
  try {
    const token = String(req.body?.token || "");

    const tokens = loadTokens();

    if (!token || token !== String(tokens.host || "")) {
      return res.status(401).json({
        success: false,
        message: "設定係の認証に失敗しました"
      });
    }

    const db = getFirebaseDb();

    const snap =
      await db.collection("events").get();

    const events = [];

    snap.forEach((doc) => {
      const data = doc.data() || {};

      events.push({
        eventId:
          String(data.eventId || doc.id || ""),
        note:
          String(data.note || ""),
        updatedAt:
          data.updatedAt || ""
      });
    });

    events.sort((a, b) =>
      String(b.updatedAt || "")
        .localeCompare(String(a.updatedAt || ""))
    );

    return res.json({
      success: true,
      events
    });

  } catch (error) {
    console.error(
      "FIREBASE EVENTS ERROR",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Firebaseの大会一覧を取得できませんでした"
    });
  }
});


// =====================================================
// 設定係：Firebase 大会名簿取得
// =====================================================
app.post("/api/host/firebase-roster", async (req, res) => {
  try {
    const token =
      String(req.body?.token || "");

    const eventId =
      String(req.body?.eventId || "").trim();

    const tokens = loadTokens();

    if (!token || token !== String(tokens.host || "")) {
      return res.status(401).json({
        success: false,
        message: "設定係の認証に失敗しました"
      });
    }

    if (!/^\d{10}$/.test(eventId)) {
      return res.status(400).json({
        success: false,
        message:
          "大会IDは10桁の半角数字で指定してください"
      });
    }

    const db = getFirebaseDb();

    const eventRef =
      db.collection("events").doc(eventId);

    const eventDoc =
      await eventRef.get();

    if (!eventDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "大会が見つかりません"
      });
    }

    const rosterSnap =
      await eventRef
        .collection("roster")
        .get();

    const roster = [];

    rosterSnap.forEach((doc) => {
      const data = doc.data() || {};

      roster.push({
        lane: String(data.lane || doc.id || ""),
        bib: String(data.bib || ""),
        name: String(data.name || ""),
        team: String(data.team || "")
      });
    });

    roster.sort(
      (a, b) =>
        Number(a.lane) - Number(b.lane)
    );

    const eventData =
      eventDoc.data() || {};

    return res.json({
      success: true,

      event: {
        eventId:
          String(
            eventData.eventId ||
            eventId
          ),
        note:
          String(eventData.note || "")
      },

      roster
    });

  } catch (error) {
    console.error(
      "FIREBASE ROSTER ERROR",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Firebaseの名簿を取得できませんでした"
    });
  }
});
// ========================================
// 管理者ログイン
// ========================================
app.post("/api/admin-login", (req, res) => {
  try {
    const passcode = String(req.body?.passcode || "");

    if (!ADMIN_PASSCODE) {
      return res.status(500).json({
        success: false,
        message: "管理者パスコードが設定されていません。"
      });
    }

    if (passcode !== ADMIN_PASSCODE) {
      return res.status(401).json({
        success: false,
        message: "管理者パスコードが違います。"
      });
    }

  adminToken = crypto.randomBytes(32).toString("hex");

return res.json({
  success: true,
  token: adminToken
});

  } catch (error) {
    console.error("ADMIN LOGIN ERROR", error);

    return res.status(500).json({
      success: false,
      message: "管理者ログインに失敗しました。"
    });
  }
});   
// ========================================
// 管理者：設定係トークン更新
// ========================================
app.post("/api/admin/regen-host-token", async (req, res) => {
  try {
    const token = String(req.body?.token || "");

    // 管理者としてログインしていない
    if (!adminToken || token !== adminToken) {
      return res.status(401).json({
        success: false,
        message: "管理者の認証が必要です。"
      });
    }

    const tokens = loadTokens();

    // 設定係トークンを新しくする
    tokens.host ="rw_HOST_" + makeToken();

await saveTokens(tokens);

    return res.json({
      success: true,
      message: "設定係トークンを更新しました。"
    });

  } catch (error) {
    console.error("REGEN HOST TOKEN ERROR", error);

    return res.status(500).json({
      success: false,
      message: "設定係トークンの更新に失敗しました。"
    });
  }
});
// ========================================
// 管理者ログアウト
// ========================================
app.post("/api/admin/logout", (req, res) => {
  const token = String(req.body?.token || "");

  if (adminToken && token === adminToken) {
    adminToken = "";
  }

  return res.json({
    success: true
  });
});
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });

wss.on("connection", (ws) => {
  state.clients.add(ws);

  let role = "judge";
  let judgeId = null;
  let authed = false;

  ws.on("message", async (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString("utf8"));
    } catch {
      return;
    }

    const op = msg.op;

    // -----------------------------
    // HELLO
    // -----------------------------
    if (op === "HELLO") {
      const reqRole = String(msg.role || "judge");
      const reqJudgeId = msg.judgeId ? String(msg.judgeId) : null;
      const token = String(msg.token || msg.t || "");

      

      if (!tokenOkFor(reqRole, reqJudgeId, token)) {
        
        send(ws, { op: "REJECT", reason: "tokenが違うか、この役割の権限がありません" });
        try { ws.close(); } catch {}
        return;
      }

      role = reqRole;
      judgeId = reqJudgeId;
      authed = true;

      send(ws, snapshotFor(role, judgeId));
      return;
    }

    if (!authed) {
      return reject(ws, "最初にHELLOしてください");
    }

    const allowed = requiredRole(op);
    if (allowed && !allowed.includes(role)) {
      return reject(ws, "この操作は許可されていません（役割が違います）");
    }

    // -----------------------------
    // Host tools
    // -----------------------------
    if (op === "LOAD_ROSTER") {
      const g = safeGroup(msg.group);
      const roster = readRoster(g);
      send(ws, { op: "ROSTER_DATA", group: g, roster });
      return;
    }

    if (op === "SAVE_ROSTER") {
      const g = safeGroup(msg.group);
      const roster = Array.isArray(msg.roster) ? msg.roster : [];
      const out = [];

      for (const a of roster) {
        const lane = String(a.lane || "").trim();
        const name = String(a.name || "").trim();

        if (!lane || !name) continue;
        if (!isHalfWidthDigits(lane)) continue;

        out.push({
          lane,
          bib: String(a.bib || ""),
          name,
          team: String(a.team || ""),
        });
      }

      writeRoster(g, out);
      send(ws, { op: "OK", kind: "SAVE_ROSTER", group: g });
      return;
    }

    if (op === "CLEAR_ROSTER") {
      const g = safeGroup(msg.group);
      writeRoster(g, []);
      send(ws, { op: "OK", kind: "CLEAR_ROSTER", group: g });
      return;
    }

    if (op === "APPLY_GROUP") {
      const g = safeGroup(msg.group);

      if (state.raceActive) {
        return reject(
          ws,
          `現在グループ${state.currentGroup}が競技中です。先に現在の競技を終了してください`
        );
      }

            applyGroup(g);
      state.raceActive = true;

      // 競技開始状態・グループ・名簿をFirebase保存
      await saveRuntimeToFirebase(state);

      broadcast({
        op: "EVENT",
        kind: "RESET",
        raceId: state.raceId,
        currentGroup: state.currentGroup,
        raceActive: state.raceActive,
      });

      broadcast({
        op: "EVENT",
        kind: "ROSTER",
        roster: Object.values(state.rosterByLane),
      });

      broadcast({
        op: "EVENT",
        kind: "RACE_STATE",
        raceActive: state.raceActive,
        currentGroup: state.currentGroup,
      });

      send(ws, { op: "OK", kind: "APPLY_GROUP", group: g });
      return;
    }

    if (op === "END_RACE") {
      if (!state.raceActive) {
        return reject(ws, "現在、競技中のグループはありません");
      }

            state.raceActive = false;

      // 競技終了状態をFirebase保存
      await saveRuntimeToFirebase(state);

      broadcast({
        op: "EVENT",
        kind: "RACE_STATE",
        raceActive: state.raceActive,
        currentGroup: state.currentGroup,
      });

      send(ws, {
        op: "OK",
        kind: "END_RACE",
        group: state.currentGroup,
      });
      return;
    }

    if (op === "GET_TOKENS") {
  const tokens = loadTokens();

  send(ws, {
    op: "TOKENS_DATA",
    tokens,
  });

  return;
}

    if (op === "REGEN_TOKEN") {
      const target = String(msg.target || "");
      const allowedTargets = [
        "judge1", "judge2", "judge3", "judge4", "judge5",
        "chiefjudge", "recorder", "chief",
      ];

      if (!allowedTargets.includes(target)) {
        return reject(ws, "targetが不正です");
      }

      const tokens = loadTokens();
            tokens[target] = makeToken();
      await saveTokens(tokens);

      send(ws, {
        op: "OK",
        kind: "REGEN_TOKEN",
        target,
        token: tokens[target],
      });
      return;
    }

  if (op === "REGEN_ALL_TOKENS") {
  const tokens = loadTokens();

  // 設定係(host)はそのまま保持し、
  // その他の役割だけ更新する
  tokens.judge1 = makeToken();
  tokens.judge2 = makeToken();
  tokens.judge3 = makeToken();
  tokens.judge4 = makeToken();
  tokens.judge5 = makeToken();

  tokens.chiefjudge = makeToken();
  tokens.recorder = makeToken();
  tokens.chief = makeToken();

await saveTokens(tokens);

send(ws, {
  op: "OK",
  kind: "REGEN_ALL_TOKENS",
  tokens,
});

  return;
}

    // -----------------------------
    // Recorder actions
    // -----------------------------
if (op === "CONFIRM") {
  const id = String(msg.id || "");
  const inf = state.byId[id];

  if (!inf) return;

  inf.status = "confirmed";

  await saveRecordToFirebase(inf);

  broadcast({
    op: "EVENT",
    kind: "UPDATE",
    item: inf,
  });

  return;
}
if (op === "CANCEL") {
  const id = String(msg.id || "");
  const inf = state.byId[id];

  if (!inf) return;

  if (inf.level !== "warning") {
    return reject(ws, "取消できるのは警告だけです");
  }

  inf.status = "cancelled";

  // 警告取消後、同じ審判が同じレーンに再入力できるようにする
  const lk = lockKey(
    inf.raceId,
    inf.judgeId,
    inf.lane
  );
  delete state.judgeLaneWarnLock[lk];

  // 同じ警告の重複チェックも解除する
  const kThis = keyOf(
    inf.raceId,
    inf.judgeId,
    inf.lane,
    inf.type,
    inf.level
  );
    delete state.activeKeyToId[kThis];

  // 取消状態をFirebaseにも保存
  await saveRecordToFirebase(inf);

  broadcast({
    op: "EVENT",
    kind: "UPDATE",
    item: inf,
  });

  return;
}
    // -----------------------------
    // Chief actions
    // -----------------------------
    if (op === "RESET") {
      if (state.raceActive) {
        return reject(
          ws,
          `グループ${state.currentGroup}が競技中のため、ログ初期化はできません`
        );
      }

            resetLogKeepRoster();

      await saveRuntimeToFirebase(state);

      broadcast({
        op: "EVENT",
        kind: "RESET",
        raceId: state.raceId,
        currentGroup: state.currentGroup,
        raceActive: state.raceActive,
      });
      return;
    }

    // -----------------------------
    // Judge actions
    // -----------------------------
    if (op === "NEW_CAUTION" || op === "NEW_WARNING") {
      const lane = String(msg.lane || "").trim();
      const type = msg.type === "loss" ? "loss" : "bent";
      const jId = String(judgeId || "").trim();

      if (!lane) return reject(ws, "レーンが空です");
      if (!isHalfWidthDigits(lane)) return reject(ws, "レーンは半角数字のみです");
      if (!ensureLaneRegistered(lane)) return reject(ws, "そのレーンは未登録です（設定係に確認）");
      if (!jId) return reject(ws, "審判IDが不明です");

      const lk = lockKey(state.raceId, jId, lane);
      if (state.judgeLaneWarnLock[lk]) {
        return reject(ws, "この審判はこの競技者に既に警告を出しているため、以後は注意・警告を出せません");
      }

      const level = op === "NEW_CAUTION" ? "caution" : "warning";
      const kThis = keyOf(state.raceId, jId, lane, type, level);

      if (state.activeKeyToId[kThis]) {
        return reject(ws, "同一審判は同一競技者に同じ注意・警告を2回出せません");
      }

      const status = level === "caution" ? "confirmed" : "pending";

      const inf = {
        id: nextId(),
        raceId: state.raceId,
        group: state.currentGroup,
        lane,
        type,
        level,
        hhmm: hhmmNow(),
        tsMs: Date.now(),
        judgeId: jId,
        status,
      };

      state.byId[inf.id] = inf;
      state.activeKeyToId[kThis] = inf.id;

            if (level === "warning") {
        state.judgeLaneWarnLock[lk] = true;
      }

      // 注意・警告をFirebaseへ保存
      await saveRecordToFirebase(inf);

      // seqも保存
      await saveRuntimeToFirebase(state);

      broadcast({
        op: "EVENT",
        kind: "NEW",
        item: inf
      });
      return;
    }

    // -----------------------------
    // Chief Judge actions
    // -----------------------------
    if (op === "NEW_CHIEF") {
      const lane = String(msg.lane || "").trim();
      const ctype =
        msg.type === "dsq1" ? "dsq1" :
        msg.type === "dsq2" ? "dsq2" : "notice";

      if (!lane) return reject(ws, "レーンが空です");
      if (!isHalfWidthDigits(lane)) return reject(ws, "レーンは半角数字のみです");
      if (!ensureLaneRegistered(lane)) return reject(ws, "そのレーンは未登録です（設定係に確認）");

      const inf = {
        id: nextId(),
        raceId: state.raceId,
        group: state.currentGroup,
        lane,
        type: ctype,
        level: ctype,
        hhmm: hhmmNow(),
        tsMs: Date.now(),
        judgeId: "CJ",
        status: ctype === "notice" ? "confirmed" : "pending",
      };

            state.byId[inf.id] = inf;

      await saveRecordToFirebase(inf);

      // seqをFirebaseへ保存
      await saveRuntimeToFirebase(state);

      broadcast({
        op: "EVENT",
        kind: "NEW",
        item: inf
      });

      return;
    }
  });

  ws.on("close", () => {
    state.clients.delete(ws);
  });
});

// =====================================================
// Listen
// =====================================================
// =====================================================
// Startup
// =====================================================
async function startServer() {

  try {

        // Webサーバーを公開する前に
    // Firebaseから当日トークンを復元
    await initializeTokens();

    // 現在の競技状態・名簿・記録を復元
    await initializeRuntime();

    server.listen(
      PORT,
      "0.0.0.0",
      () => {

        console.log(
          `Racewalk Web Host running on port ${PORT}`
        );

        console.log(
          "当日トークン：Firebase永続化 有効"
        );
      }
    );

  } catch (error) {

    console.error(
      "SERVER START ERROR",
      error
    );

    process.exit(1);
  }
}

startServer();
