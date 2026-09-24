// firebase-store.js
// Renderサーバー側のFirebase / Firestore 永続保存

const admin = require("firebase-admin");

let firebaseDb = null;


// =====================================================
// Firebase Admin
// =====================================================
function getFirebaseDb() {
  if (firebaseDb) {
    return firebaseDb;
  }

  const raw =
    process.env.FIREBASE_SERVICE_ACCOUNT || "";

  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT が設定されていません"
    );
  }

  const serviceAccount =
    JSON.parse(raw);

  if (!admin.apps.length) {
    admin.initializeApp({
      credential:
        admin.credential.cert(serviceAccount),
    });
  }

  firebaseDb =
    admin.firestore();

  return firebaseDb;
}


// =====================================================
// Racewalk system document
// =====================================================
function racewalkSystemRef() {
  return getFirebaseDb()
    .collection("system")
    .doc("racewalk");
}


// =====================================================
// 当日トークン
// =====================================================
async function saveTokens(tokens) {
  const cleanTokens = {
    host:
      String(tokens?.host || ""),

    judge1:
      String(tokens?.judge1 || ""),

    judge2:
      String(tokens?.judge2 || ""),

    judge3:
      String(tokens?.judge3 || ""),

    judge4:
      String(tokens?.judge4 || ""),

    judge5:
      String(tokens?.judge5 || ""),

    chiefjudge:
      String(tokens?.chiefjudge || ""),

    recorder:
      String(tokens?.recorder || ""),

    chief:
      String(tokens?.chief || ""),
  };

  await racewalkSystemRef().set(
    {
      tokens: cleanTokens,

      tokensUpdatedAt:
        admin.firestore.FieldValue
          .serverTimestamp(),
    },
    { merge: true }
  );

  return cleanTokens;
}


async function loadTokens() {
  const doc =
    await racewalkSystemRef().get();

  if (!doc.exists) {
    return null;
  }

  const data =
    doc.data() || {};

  const tokens =
    data.tokens;

  if (
    !tokens ||
    typeof tokens !== "object"
  ) {
    return null;
  }

  return {
    host:
      String(tokens.host || ""),

    judge1:
      String(tokens.judge1 || ""),

    judge2:
      String(tokens.judge2 || ""),

    judge3:
      String(tokens.judge3 || ""),

    judge4:
      String(tokens.judge4 || ""),

    judge5:
      String(tokens.judge5 || ""),

    chiefjudge:
      String(tokens.chiefjudge || ""),

    recorder:
      String(tokens.recorder || ""),

    chief:
      String(tokens.chief || ""),
  };
}


// =====================================================
// 現在の競技状態
// =====================================================
async function saveRuntime(state) {
  const roster =
    Object.values(
      state.rosterByLane || {}
    ).map((a) => ({
      lane:
        String(a.lane || ""),

      bib:
        String(a.bib || ""),

      name:
        String(a.name || ""),

      team:
        String(a.team || ""),
    }));

  await racewalkSystemRef().set(
    {
      runtime: {
        raceId:
          String(state.raceId || ""),

        seq:
          Number(state.seq || 1),

        currentGroup:
          Number(
            state.currentGroup || 1
          ),

        raceActive:
          state.raceActive === true,

        roster,
      },

      runtimeUpdatedAt:
        admin.firestore.FieldValue
          .serverTimestamp(),
    },
    { merge: true }
  );
}


async function loadRuntime() {
  const doc =
    await racewalkSystemRef().get();

  if (!doc.exists) {
    return null;
  }

  const data =
    doc.data() || {};

  const runtime =
    data.runtime;

  if (
    !runtime ||
    typeof runtime !== "object"
  ) {
    return null;
  }

  return {
    raceId:
      String(runtime.raceId || ""),

    seq:
      Number(runtime.seq || 1),

    currentGroup:
      Number(runtime.currentGroup || 1),

    raceActive:
      runtime.raceActive === true,

    roster:
      Array.isArray(runtime.roster)
        ? runtime.roster
        : [],
  };
}


// =====================================================
// 注意・警告・失格・通告
// =====================================================
async function saveRecord(item) {
  if (
    !item?.id ||
    !item?.raceId
  ) {
    throw new Error(
      "保存する競技記録のIDまたはraceIdがありません"
    );
  }

  // raceId + 記録IDにして、
  // 次の競技のINF-00001との重複を防ぐ
  const docId =
    `${item.raceId}_${item.id}`;

  await racewalkSystemRef()
    .collection("records")
    .doc(docId)
    .set(
      {
        ...item,

        updatedAt:
          admin.firestore.FieldValue
            .serverTimestamp(),
      },
      { merge: true }
    );
}


async function loadRecords(raceId) {
  if (!raceId) {
    return [];
  }

  const snap =
    await racewalkSystemRef()
      .collection("records")
      .where(
        "raceId",
        "==",
        String(raceId)
      )
      .get();

  const records = [];

  snap.forEach((doc) => {
    const data =
      doc.data() || {};

    records.push({
      ...data,

      id:
        String(
          data.id || ""
        ),
    });
  });

  records.sort(
    (a, b) =>
      Number(a.tsMs || 0) -
      Number(b.tsMs || 0)
  );

  return records;
}


// =====================================================
// Firebaseに保存されている大会一覧
// =====================================================
async function getEvents() {
  const db =
    getFirebaseDb();

  const snap =
    await db
      .collection("events")
      .get();

  const events = [];

  snap.forEach((doc) => {
    const data =
      doc.data() || {};

    events.push({
      eventId:
        String(
          data.eventId ||
          doc.id ||
          ""
        ),

      note:
        String(data.note || ""),

      updatedAt:
        data.updatedAt || "",
    });
  });

  events.sort(
    (a, b) =>
      String(b.updatedAt || "")
        .localeCompare(
          String(a.updatedAt || "")
        )
  );

  return events;
}


// =====================================================
// 指定大会の名簿
// =====================================================
async function getEventRoster(eventId) {
  const db =
    getFirebaseDb();

  const eventRef =
    db
      .collection("events")
      .doc(eventId);

  const eventDoc =
    await eventRef.get();

  if (!eventDoc.exists) {
    return null;
  }

  const rosterSnap =
    await eventRef
      .collection("roster")
      .get();

  const roster = [];

  rosterSnap.forEach((doc) => {
    const data =
      doc.data() || {};

    roster.push({
      lane:
        String(
          data.lane ||
          doc.id ||
          ""
        ),

      bib:
        String(data.bib || ""),

      name:
        String(data.name || ""),

      team:
        String(data.team || ""),
    });
  });

  roster.sort(
    (a, b) =>
      Number(a.lane) -
      Number(b.lane)
  );

  const eventData =
    eventDoc.data() || {};

  return {
    event: {
      eventId:
        String(
          eventData.eventId ||
          eventId
        ),

      note:
        String(
          eventData.note || ""
        ),
    },

    roster,
  };
}
// =====================================================
// 当日のグループ別名簿
// =====================================================

// グループ名簿をFirebaseへ保存
async function saveGroupRoster(group, roster) {
  const g = Math.min(
    5,
    Math.max(1, Number(group) || 1)
  );

  const cleanRoster = Array.isArray(roster)
    ? roster.map((a) => ({
        lane: String(a?.lane || "").trim(),
        bib: String(a?.bib || ""),
        name: String(a?.name || "").trim(),
        team: String(a?.team || ""),
      }))
      .filter(
        (a) =>
          a.lane &&
          a.name &&
          /^\d+$/.test(a.lane)
      )
    : [];

  await racewalkSystemRef().set(
    {
      groupRosters: {
        [`group${g}`]: cleanRoster,
      },

      groupRostersUpdatedAt:
        admin.firestore.FieldValue
          .serverTimestamp(),
    },
    { merge: true }
  );

  return cleanRoster;
}


// グループ名簿をFirebaseから取得
async function loadGroupRoster(group) {
  const g = Math.min(
    5,
    Math.max(1, Number(group) || 1)
  );

  const doc =
    await racewalkSystemRef().get();

  if (!doc.exists) {
    return [];
  }

  const data = doc.data() || {};

  const roster =
    data.groupRosters?.[`group${g}`];

  if (!Array.isArray(roster)) {
    return [];
  }

  return roster
    .map((a) => ({
      lane: String(a?.lane || "").trim(),
      bib: String(a?.bib || ""),
      name: String(a?.name || "").trim(),
      team: String(a?.team || ""),
    }))
    .filter(
      (a) =>
        a.lane &&
        a.name &&
        /^\d+$/.test(a.lane)
    )
    .sort(
      (a, b) =>
        Number(a.lane) -
        Number(b.lane)
    );
}
// =====================================================
// 設定係パスコード
// =====================================================

async function saveHostPasscode(data) {
  const db = getFirebaseDb();

  await db
    .collection("system")
    .doc("auth")
    .set(
      {
        hostPasscode: {
          salt: String(data?.salt || ""),
          hash: String(data?.hash || ""),
        },
        updatedAt: Date.now(),
      },
      { merge: true }
    );
}


async function loadHostPasscode() {
  const db = getFirebaseDb();

  const snap = await db
    .collection("system")
    .doc("auth")
    .get();

  if (!snap.exists) {
    return null;
  }

  const data = snap.data() || {};
  const saved = data.hostPasscode;

  if (
    !saved ||
    !saved.salt ||
    !saved.hash
  ) {
    return null;
  }

  return {
    salt: String(saved.salt),
    hash: String(saved.hash),
  };
}
// =====================================================
// Export
// =====================================================
module.exports = {
  getFirebaseDb,

  saveTokens,
  loadTokens,

  saveRuntime,
  loadRuntime,

  saveRecord,
  loadRecords,

  getEvents,
  getEventRoster,

  saveGroupRoster,
  loadGroupRoster,

  saveHostPasscode,
  loadHostPasscode,
};
