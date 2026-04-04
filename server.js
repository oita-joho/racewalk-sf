// server.js  (FULL REPLACE)
// Node: express + ws
// Run: node server.js

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
let serverClockOffset = 0;

// =====================================================
// Config / Files
// =====================================================
const PORT = process.env.PORT || 8080;
const DATA_DIR = path.join(__dirname, "data");
const ROSTER_FILE = (g) => path.join(DATA_DIR, `roster_g${g}.json`);
const TOKENS_FILE = path.join(DATA_DIR, "tokens.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// =====================================================
// Utilities
// =====================================================
function safeGroup(g) {
  const n = parseInt(g, 10);
  return [1, 2, 3, 4, 5].includes(n) ? n : 1;
}

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

  const hh = parts.find(p => p.type === "hour")?.value || "00";
  const mm = parts.find(p => p.type === "minute")?.value || "00";

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
// Token auth (tokens.json)
// =====================================================
// =====================================================
// Token auth (fixed tokens)
// =====================================================
const TOKENS = {
  judge1: "rw_J1_a8K3mP4xQ7n2",
  judge2: "rw_J2_f6L9tR1vY3c8",
  judge3: "rw_J3_p2N7kD5sW8m4",
  judge4: "rw_J4_q9H2xB6uT1z5",
  judge5: "rw_J5_m4C8jL2pR7y9",
  chiefjudge: "rw_CJ_v7K1nQ5dX9p3",
  recorder: "rw_REC_t3M8wF2kL6q1",
  chief: "rw_CHIEF_b5P9rN4xD7s2",
  host: "rw_HOST_z8T1mV6qK3c9",
};

function loadTokens() {
  return TOKENS;
}

function saveTokens(tokens) {
  // 固定トークンなので保存しない
}
function makeToken(len = 16) {
  return crypto.randomBytes(24).toString("base64url").slice(0, len);
}

function defaultTokens() {
  return {
    judge1: makeToken(),
    judge2: makeToken(),
    judge3: makeToken(),
    judge4: makeToken(),
    judge5: makeToken(),
    chiefjudge: makeToken(),
    recorder: makeToken(),
    chief: makeToken(),
    host: makeToken(),
  };
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
  // board と host は一時公開
  if (role === "board") return true; // boardは公開のまま

if (role === "host") {
  return TOKENS.host === String(token || "").trim();
}

  const t = String(token || "").trim();
  if (!t) return false;

  const tokens = loadTokens();

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

  if (op === "CONFIRM") return ["recorder"];
  if (op === "RESET") return ["chief"];
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

// =====================================================
// Runtime State
// =====================================================
const state = {
  raceId: String(Date.now()),
  seq: 1,
  currentGroup: 1,

  rosterByLane: {},
  byId: {},
  activeKeyToId: {},
  judgeLaneWarnLock: {},
  clients: new Set(),
};

function nextId() {
  return `INF-${String(state.seq++).padStart(5, "0")}`;
}

function keyOf(raceId, judgeId, lane, type, level) {
  return `${raceId}|${judgeId}|${lane}|${type}|${level}`;
}

function lockKey(raceId, judgeId, lane) {
  return `${raceId}|${judgeId}|${lane}`;
}

function ensureLaneRegistered(lane) {
  return !!state.rosterByLane[String(lane)];
}

function resetLogKeepRoster() {
  state.raceId = String(Date.now());
  state.seq = 1;
  state.byId = {};
  state.activeKeyToId = {};
  state.judgeLaneWarnLock = {};
}

function applyGroup(group) {
  const g = safeGroup(group);
  state.currentGroup = g;

  const roster = readRoster(g);
  const map = {};
  for (const a of roster) {
    const lane = String(a.lane || "").trim();
    const name = String(a.name || "").trim();
    if (!lane || !name) continue;
    if (!isHalfWidthDigits(lane)) continue;

    map[lane] = {
      lane,
      bib: String(a.bib || ""),
      name,
      team: String(a.team || ""),
    };
  }
  state.rosterByLane = map;

  resetLogKeepRoster();
}

applyGroup(1);

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
    items = items.filter((x) => x.status === "confirmed");
  }

  items.sort((a, b) => (b.tsMs || 0) - (a.tsMs || 0));

  return {
    op: "SNAPSHOT",
    raceId: state.raceId,
    currentGroup: state.currentGroup,
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

  const hh = parts.find(p => p.type === "hour")?.value || "00";
  const mm = parts.find(p => p.type === "minute")?.value || "00";
  const ss = parts.find(p => p.type === "second")?.value || "00";

  res.json({
    hhmm: `${hh}:${mm}`,
    hhmmss: `${hh}:${mm}:${ss}`,
    ts: now.getTime()
  });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });

wss.on("connection", (ws) => {
  state.clients.add(ws);

  let role = "judge";
  let judgeId = null;
  let authed = false;

  ws.on("message", (buf) => {
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

      console.log("HELLO", { reqRole, reqJudgeId, token });

      if (!tokenOkFor(reqRole, reqJudgeId, token)) {
        console.log("TOKEN NG", { reqRole, reqJudgeId, token });
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
      applyGroup(g);

      broadcast({
        op: "EVENT",
        kind: "RESET",
        raceId: state.raceId,
        currentGroup: state.currentGroup,
      });

      broadcast({
        op: "EVENT",
        kind: "ROSTER",
        roster: Object.values(state.rosterByLane),
      });

      broadcast(snapshotFor("recorder", null));
      send(ws, { op: "OK", kind: "APPLY_GROUP", group: g });
      return;
    }

    if (op === "GET_TOKENS") {
      const tokens = loadTokens();
      send(ws, { op: "TOKENS_DATA", tokens });
      return;
    }

    if (op === "REGEN_TOKEN") {
      const target = String(msg.target || "");
      const allowedTargets = [
        "judge1", "judge2", "judge3", "judge4", "judge5",
        "chiefjudge", "recorder", "chief", "host",
      ];

      if (!allowedTargets.includes(target)) {
        return reject(ws, "targetが不正です");
      }

      const tokens = loadTokens();
      tokens[target] = makeToken();
      saveTokens(tokens);

      send(ws, {
        op: "OK",
        kind: "REGEN_TOKEN",
        target,
        token: tokens[target],
      });
      return;
    }

    if (op === "REGEN_ALL_TOKENS") {
      const tokens = defaultTokens();
      saveTokens(tokens);
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
      broadcast({ op: "EVENT", kind: "UPDATE", item: inf });
      return;
    }

    // -----------------------------
    // Chief actions
    // -----------------------------
    if (op === "RESET") {
      resetLogKeepRoster();

      broadcast({
        op: "EVENT",
        kind: "RESET",
        raceId: state.raceId,
        currentGroup: state.currentGroup,
      });
      broadcast(snapshotFor("recorder", null));
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

      broadcast({ op: "EVENT", kind: "NEW", item: inf });
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
      broadcast({ op: "EVENT", kind: "NEW", item: inf });
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
server.listen(PORT, "0.0.0.0", () => {
  const ips = localIPv4Candidates();

  console.log(`Racewalk Web Host running: http://0.0.0.0:${PORT}`);

  if (ips.length) {
    const ip = ips[0];
    console.log(`Judge1:       http://${ip}:${PORT}/#/judge?jid=J1&t=${TOKENS.judge1}`);
    console.log(`Judge2:       http://${ip}:${PORT}/#/judge?jid=J2&t=${TOKENS.judge2}`);
    console.log(`Judge3:       http://${ip}:${PORT}/#/judge?jid=J3&t=${TOKENS.judge3}`);
    console.log(`Judge4:       http://${ip}:${PORT}/#/judge?jid=J4&t=${TOKENS.judge4}`);
    console.log(`Judge5:       http://${ip}:${PORT}/#/judge?jid=J5&t=${TOKENS.judge5}`);
    console.log(`ChiefJudge:   http://${ip}:${PORT}/#/chiefjudge?t=${TOKENS.chiefjudge}`);
    console.log(`Recorder:     http://${ip}:${PORT}/#/recorder?t=${TOKENS.recorder}`);
    console.log(`Chief(Reset): http://${ip}:${PORT}/#/chief?t=${TOKENS.chief}`);
    console.log(`Board:        http://${ip}:${PORT}/#/board`);
    console.log(`Host(PC):     http://${ip}:${PORT}/#/host?t=${TOKENS.host}`);
  }

  console.log(`WS: ws://<PC-IP>:${PORT}/ws`);
});
