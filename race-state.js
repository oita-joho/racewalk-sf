// race-state.js
// 競歩システム：競技状態管理

const firebaseStore =
  require("./firebase-store");


// =====================================================
// Runtime State
// =====================================================
const state = {
  raceId: String(Date.now()),
  seq: 1,
  currentGroup: 1,
  raceActive: false,

  rosterByLane: {},
  byId: {},

  // 同一注意・警告の重複防止
  activeKeyToId: {},

  // 同一審判・同一選手への
  // 警告後の再入力防止
  judgeLaneWarnLock: {},

  // WebSocket接続
  clients: new Set(),
};


// =====================================================
// 基本処理
// =====================================================
function safeGroup(group) {
  const n =
    parseInt(group, 10);

  return [1, 2, 3, 4, 5]
    .includes(n)
    ? n
    : 1;
}


function nextId() {
  return (
    "INF-" +
    String(state.seq++)
      .padStart(5, "0")
  );
}


function keyOf(
  raceId,
  judgeId,
  lane,
  type,
  level
) {
  return [
    raceId,
    judgeId,
    lane,
    type,
    level,
  ].join("|");
}


function lockKey(
  raceId,
  judgeId,
  lane
) {
  return [
    raceId,
    judgeId,
    lane,
  ].join("|");
}


function ensureLaneRegistered(lane) {
  return !!state.rosterByLane[
    String(lane)
  ];
}


// =====================================================
// 競技記録初期化
// 名簿・グループは維持
// =====================================================
function resetLogKeepRoster() {
  state.raceId =
    String(Date.now());

  state.seq = 1;

  state.byId = {};
  state.activeKeyToId = {};
  state.judgeLaneWarnLock = {};
}


// =====================================================
// 名簿を現在の競技へ設定
// =====================================================
function setRoster(roster) {
  const map = {};

  for (
    const a of
    Array.isArray(roster)
      ? roster
      : []
  ) {
    const lane =
      String(a.lane || "").trim();

    const name =
      String(a.name || "").trim();

    if (!lane || !name) {
      continue;
    }

    if (!/^\d+$/.test(lane)) {
      continue;
    }

    map[lane] = {
      lane,

      bib:
        String(a.bib || ""),

      name,

      team:
        String(a.team || ""),
    };
  }

  state.rosterByLane = map;

  return map;
}


// =====================================================
// グループ適用
// rosterはserver.jsから渡す
// =====================================================
function applyGroup(
  group,
  roster
) {
  state.currentGroup =
    safeGroup(group);

  setRoster(roster);

  resetLogKeepRoster();
}


// =====================================================
// Firebaseから競技状態を復元
// =====================================================
async function initializeRuntime() {
  const runtime =
    await firebaseStore.loadRuntime();

  // Firebaseに競技状態がまだ無い
  if (
    !runtime ||
    !runtime.raceId
  ) {
    await firebaseStore.saveRuntime(
      state
    );

    console.log(
      "競技状態をFirebaseへ初回保存しました"
    );

    return;
  }


  // ---------------------------------------------------
  // 基本状態
  // ---------------------------------------------------
  state.raceId =
    String(runtime.raceId);

  state.seq =
    Math.max(
      1,
      Number(runtime.seq || 1)
    );

  state.currentGroup =
    safeGroup(
      runtime.currentGroup
    );

  state.raceActive =
    runtime.raceActive === true;


  // ---------------------------------------------------
  // 名簿
  // ---------------------------------------------------
  setRoster(runtime.roster);


  // ---------------------------------------------------
  // 現在の競技記録
  // ---------------------------------------------------
  const records =
    await firebaseStore.loadRecords(
      state.raceId
    );

  state.byId = {};
  state.activeKeyToId = {};
  state.judgeLaneWarnLock = {};


  for (const inf of records) {
    if (!inf?.id) {
      continue;
    }

    state.byId[inf.id] = inf;


    // 取消済みは重複防止対象外
    if (
      inf.status === "cancelled"
    ) {
      continue;
    }


    const key =
      keyOf(
        inf.raceId,
        inf.judgeId,
        inf.lane,
        inf.type,
        inf.level
      );

    state.activeKeyToId[key] =
      inf.id;


    // 警告済みロックを復元
    if (
      inf.level === "warning" &&
      inf.judgeId &&
      inf.lane
    ) {
      const warningKey =
        lockKey(
          inf.raceId,
          inf.judgeId,
          inf.lane
        );

      state.judgeLaneWarnLock[
        warningKey
      ] = true;
    }
  }


  console.log(
    "競技状態をFirebaseから復元しました：" +
    `グループ${state.currentGroup} / ` +
    (
      state.raceActive
        ? "競技中"
        : "停止中"
    ) +
    ` / 記録${records.length}件`
  );
}


// =====================================================
// Export
// =====================================================
module.exports = {
  state,

  safeGroup,
  nextId,
  keyOf,
  lockKey,
  ensureLaneRegistered,

  resetLogKeepRoster,
  setRoster,
  applyGroup,

  initializeRuntime,
};
