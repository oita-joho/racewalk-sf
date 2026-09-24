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
const auth = require("./auth");
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
const {
  makeToken,
  initializeTokens,
  loadTokens,
  saveTokens,

  setHostPasscode,
  verifyHostPasscode,

  tokenOkFor,
  requiredRole,
} = auth;
// =====================================================
// Firebase Store
// =====================================================
const {
  saveRuntime: saveRuntimeToFirebase,
  saveRecord: saveRecordToFirebase,
} = firebaseStore;


// =====================================================
// Config / Files
// =====================================================
const PORT = process.env.PORT || 8080;
const ADMIN_PASSCODE =process.env.ADMIN_PASSCODE || "";
const DATA_DIR = path.join(__dirname, "data");
const ROSTER_FILE = (g) => path.join(DATA_DIR, `roster_g${g}.json`);

let adminToken = "";

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

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



async function applyGroup(group) {
  const g =
    safeGroup(group);

  const roster =
    await firebaseStore
      .loadGroupRoster(g);

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

app.post(
  "/api/host-login",
  async (req, res) => {
    try {
      const passcode =
        String(
          req.body?.passcode || ""
        );

      const ok =
        await verifyHostPasscode(
          passcode
        );

      if (!ok) {
        return res.status(401).json({
          success: false,
          message:
            "設定係パスコードが違います",
        });
      }

      const tokens =
        loadTokens();

      return res.json({
        success: true,
        token: tokens.host,
      });

    } catch (error) {
      console.error(
        "HOST LOGIN ERROR",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "設定係ログイン処理でエラーが発生しました",
      });
    }
  }
);
// =====================================================
// 設定係：Firebase 保存済み大会一覧
// =====================================================
app.post(
  "/api/host/firebase-events",
  async (req, res) => {
    try {
      const token =
        String(req.body?.token || "");

      if (
        !tokenOkFor(
          "host",
          null,
          token
        )
      ) {
        return res.status(401).json({
          success: false,
          message:
            "設定係の認証に失敗しました",
        });
      }

      const events =
        await firebaseStore.getEvents();

      return res.json({
        success: true,
        events,
      });

    } catch (error) {
      console.error(
        "FIREBASE EVENTS ERROR",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Firebaseの大会一覧を取得できませんでした",
      });
    }
  }
);


// =====================================================
// 設定係：Firebase 大会名簿取得
// =====================================================
app.post(
  "/api/host/firebase-roster",
  async (req, res) => {
    try {
      const token =
        String(req.body?.token || "");

      const eventId =
        String(
          req.body?.eventId || ""
        ).trim();

      if (
        !tokenOkFor(
          "host",
          null,
          token
        )
      ) {
        return res.status(401).json({
          success: false,
          message:
            "設定係の認証に失敗しました",
        });
      }

      if (!/^\d{10}$/.test(eventId)) {
        return res.status(400).json({
          success: false,
          message:
            "大会IDは10桁の半角数字で指定してください",
        });
      }

      const result =
        await firebaseStore
          .getEventRoster(eventId);

      if (!result) {
        return res.status(404).json({
          success: false,
          message:
            "大会が見つかりません",
        });
      }

      return res.json({
        success: true,
        ...result,
      });

    } catch (error) {
      console.error(
        "FIREBASE ROSTER ERROR",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Firebaseの名簿を取得できませんでした",
      });
    }
  }
);
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
// =====================================================
// 管理者：設定係パスコード変更
// =====================================================
app.post(
  "/api/admin/host-passcode",
  async (req, res) => {
    try {
      const token =
        String(
          req.body?.token || ""
        );

      const newPasscode =
        String(
          req.body?.passcode || ""
        ).trim();


      // 管理者認証
      if (
        !adminToken ||
        token !== adminToken
      ) {
        return res.status(401).json({
          success: false,
          message:
            "管理者認証が必要です",
        });
      }


      // パスコード確認
      if (newPasscode.length < 4) {
        return res.status(400).json({
          success: false,
          message:
            "設定係パスコードは4文字以上にしてください",
        });
      }


      // Firebaseへハッシュ保存
      await setHostPasscode(
        newPasscode
      );


      return res.json({
        success: true,
        message:
          "設定係パスコードを変更しました",
      });

    } catch (error) {
      console.error(
        "HOST PASSCODE UPDATE ERROR",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "設定係パスコードを変更できませんでした",
      });
    }
  }
);
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
  const g =
    safeGroup(msg.group);

  const roster =
    await firebaseStore
      .loadGroupRoster(g);

  send(ws, {
    op: "ROSTER_DATA",
    group: g,
    roster,
  });

  return;
}


if (op === "SAVE_ROSTER") {
  const g =
    safeGroup(msg.group);

  const roster =
    Array.isArray(msg.roster)
      ? msg.roster
      : [];

  const out = [];

  for (const a of roster) {
    const lane =
      String(a.lane || "").trim();

    const name =
      String(a.name || "").trim();

    if (!lane || !name) {
      continue;
    }

    if (!isHalfWidthDigits(lane)) {
      continue;
    }

    out.push({
      lane,
      bib:
        String(a.bib || ""),
      name,
      team:
        String(a.team || ""),
    });
  }

  await firebaseStore
    .saveGroupRoster(g, out);

  send(ws, {
    op: "OK",
    kind: "SAVE_ROSTER",
    group: g,
  });

  return;
}


if (op === "CLEAR_ROSTER") {
  const g =
    safeGroup(msg.group);

  await firebaseStore
    .saveGroupRoster(g, []);

  send(ws, {
    op: "OK",
    kind: "CLEAR_ROSTER",
    group: g,
  });

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

      await applyGroup(g);
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
