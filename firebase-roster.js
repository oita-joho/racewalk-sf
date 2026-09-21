import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

// ここを自分の Firebase 設定に変更
const firebaseConfig = {
  apiKey: "AIzaSyBYOAGmD4O5In_C9q3-IFIeOz-X4YI-gNI",
  authDomain: "racewalk-system.firebaseapp.com",
  projectId: "racewalk-system"
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
let savedEventsCache = [];
let savedEventsVisibleCount = 5;
let adminRosterCache = [];

function byId(id) {
  return document.getElementById(id);
}

function safe(v) {
  return String(v ?? "").trim();
}

function onlyDigits(v) {
  return safe(v).replace(/[^\d]/g, "").slice(0, 10);
}

function setStatus(msg) {
  const el = byId("fbStatus");
  if (el) el.textContent = msg;
}

function ensureFirebaseBox() {
  const mount = byId("firebaseMount");
  if (!mount) return;

  const isAdmin =
    location.hash.startsWith("#/admin");

  const isHost =
    location.hash.startsWith("#/host");

  let box = byId("firebaseBox");
  if (box) {
    if (box.parentNode !== mount) {
      mount.appendChild(box);
    }
    bindEvents();
    return;
  }

  box = document.createElement("div");
  box.id = "firebaseBox";
  box.className = "card";
  box.innerHTML = `
    ${isAdmin ? `
  <div class="big">
    Firebase 名簿管理
  </div>
` : `
  <div class="big">
    保存済み大会一覧
  </div>

  <div class="notice" style="margin-top:8px;">
    Firebaseに保存されている大会と名簿を読み込みます。
  </div>
`}
${isAdmin ? `
  <div class="card" style="margin-top:12px;">
    <div class="big">大会名簿CSV</div>

    <div class="row" style="margin-top:10px;">
      <input
        id="fbCsvFile"
        type="file"
        accept=".csv,text/csv"
      >

      <select id="fbCsvEnc">
        <option value="utf-8">UTF-8</option>
        <option value="shift_jis">Shift_JIS</option>
      </select>

      <button
        id="fbCsvImportBtn"
        type="button"
        class="secondary"
      >
        CSVを読み込む
      </button>
    </div>

    <div
      id="fbCsvInfo"
      class="notice"
      style="margin-top:10px;"
    >
      CSVはまだ読み込まれていません。
    </div>
  </div>
` : ""}
    ${isAdmin ? `
      <div class="row">
        <input id="fbEmail" type="email" placeholder="メールアドレス">
        <input id="fbPassword" type="password" placeholder="パスワード">

        <button id="fbLoginBtn" type="button">
          ログイン
        </button>

        <button id="fbLogoutBtn" type="button">
          ログアウト
        </button>

        <button
          id="fbResetPasswordBtn"
          type="button"
          class="secondary"
        >
          パスワードを忘れた場合
        </button>
      </div>
    ` : ""}

${isAdmin ? `
  <div class="row">
    <input
      id="fbEventId"
      type="text"
      inputmode="numeric"
      maxlength="10"
      placeholder="大会ID（10桁）"
    >

    <input
      id="fbNote"
      type="text"
      maxlength="100"
      placeholder="備考（例：春季大会・男子）"
      style="min-width:260px;flex:1"
    >
  </div>

  <div class="row">
    <button id="fbSaveBtn" type="button">
      現在の名簿をFirebase保存
    </button>

    <button id="fbLoadBtn" type="button">
      Firebaseから読込
    </button>
  </div>
` : ""}

<div id="fbStatus">
  ${
    isAdmin
      ? (
          auth.currentUser
            ? `ログイン中: ${auth.currentUser.email || ""}`
            : "未ログイン"
        )
      : "保存済み大会を選択してください"
  }
</div>

<div class="card" style="margin-top:12px">

  ${isAdmin ? `
    <div class="big">
      保存済み一覧
    </div>
  ` : ""}

  <div
    id="fbSavedList"
    class="notice"
    style="margin-top:6px"
  >
    ${
      isAdmin
        ? "未ログイン"
        : "保存済み大会を読み込んでいます..."
    }
  </div>

  <div class="row" style="margin-top:10px">
    <button
      id="fbMoreBtn"
      type="button"
      class="secondary"
    >
      もっと見る
    </button>
  </div>

  ${isHost ? `
    <div
      class="notice"
      style="margin-top:12px;"
    >
      読み込みたい大会の「読込」ボタンを押すと、
      その大会の名簿が設定されます。
    </div>
  ` : ""}

</div>
  `;

  mount.appendChild(box);
  bindEvents();
}

function bindEvents() {
  const loginBtn = byId("fbLoginBtn");
  const logoutBtn = byId("fbLogoutBtn");
  const resetPasswordBtn = byId("fbResetPasswordBtn");
  const saveBtn = byId("fbSaveBtn");
  const loadBtn = byId("fbLoadBtn");
  const moreBtn = byId("fbMoreBtn");
  const eventIdEl = byId("fbEventId");
const csvImportBtn = byId("fbCsvImportBtn");
  if (csvImportBtn) {
  csvImportBtn.onclick = async () => {
    try {
      const fileEl = byId("fbCsvFile");
      const encEl = byId("fbCsvEnc");
      const infoEl = byId("fbCsvInfo");

      if (!fileEl?.files?.[0]) {
        setStatus("CSVファイルを選択してください");
        return;
      }

      const file = fileEl.files[0];
      const enc = encEl?.value || "utf-8";
      const buf = await file.arrayBuffer();

      let text;

      try {
        text = new TextDecoder(enc).decode(buf);
      } catch {
        text = new TextDecoder("utf-8").decode(buf);
      }

      if (
        typeof window.parseRosterCsvForFirebase !== "function"
      ) {
        setStatus("CSV変換機能が見つかりません");
        return;
      }

      const roster =
        window.parseRosterCsvForFirebase(text);

      if (!Array.isArray(roster) || !roster.length) {
        setStatus(
          "有効な名簿データがありません"
        );
        return;
      }

      adminRosterCache = roster;

      if (infoEl) {
        infoEl.textContent =
          `CSV読込完了：${roster.length}名`;
      }

      setStatus(
        `CSVを読み込みました：${roster.length}名`
      );

    } catch (e) {
      console.error("[FB CSV]", e);

      setStatus(
        "CSV読込失敗: " +
        (e?.message || e)
      );
    }
  };
}
  if (eventIdEl) {
    eventIdEl.oninput = () => {
      eventIdEl.value = onlyDigits(eventIdEl.value);
    };
  }

  if (loginBtn) {
    loginBtn.onclick = async () => {
      try {
        setStatus("ログイン中...");
        const email = safe(byId("fbEmail")?.value);
        const password = byId("fbPassword")?.value || "";
        await signInWithEmailAndPassword(auth, email, password);
      } catch (e) {
        console.error("[FB LOGIN] error", e);
        setStatus("ログイン失敗: " + (e?.code || "") + " " + (e?.message || e));
      }
    };
  }
if (resetPasswordBtn) {
  resetPasswordBtn.onclick = async () => {
    const email = safe(byId("fbEmail")?.value);

    if (!email) {
      setStatus("メールアドレスを入力してください");
      return;
    }

    if (!confirm(
      `${email} にパスワード再設定メールを送信しますか？`
    )) {
      return;
    }

    try {
      setStatus("パスワード再設定メールを送信中...");

      await sendPasswordResetEmail(auth, email);

      setStatus(
        "パスワード再設定メールを送信しました。メールを確認してください。"
      );
    } catch (e) {
      console.error("[FB PASSWORD RESET] error", e);

      setStatus(
        "再設定メールの送信に失敗しました: " +
        (e?.code || "") + " " +
        (e?.message || e)
      );
    }
  };
}
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      try {
        await signOut(auth);
      } catch (e) {
        console.error(e);
        setStatus("ログアウト失敗: " + (e?.message || e));
      }
    };
  }

  if (saveBtn) {
    saveBtn.onclick = async () => {
      try {
        if (!auth.currentUser) {
          setStatus("先にログインしてください");
          return;
        }
        await saveRoster();
      } catch (e) {
        console.error(e);
        setStatus("保存失敗: " + (e?.message || e));
      }
    };
  }

  if (loadBtn) {
    loadBtn.onclick = async () => {
      try {
                await loadRoster(eventId);
      } catch (e) {
        console.error(e);
        setStatus("読込失敗: " + (e?.message || e));
      }
    };
  }

  if (moreBtn) {
    moreBtn.onclick = () => {
      savedEventsVisibleCount += 5;
      renderSavedEventsList();
    };
  }

  document.querySelectorAll("[data-fb-load]").forEach((btn) => {
    btn.onclick = async () => {
      try {
        const eventId = btn.getAttribute("data-fb-load") || "";
        const note = btn.getAttribute("data-fb-note") || "";

        const idEl = byId("fbEventId");
        const noteEl = byId("fbNote");

        if (idEl) idEl.value = eventId;
        if (noteEl) noteEl.value = note;

        await loadRoster(eventId);
      } catch (e) {
        console.error(e);
        setStatus("読込失敗: " + (e?.message || e));
      }
    };
  });
}

async function saveRoster() {
  const eventId =
    onlyDigits(byId("fbEventId")?.value);

  const note =
    safe(byId("fbNote")?.value);

  if (!/^\d{10}$/.test(eventId)) {
    setStatus("大会IDは10桁で入力してください");
    return;
  }

  const isAdmin =
  location.hash.startsWith("#/admin");

let roster = [];

if (isAdmin) {
  roster = Array.isArray(adminRosterCache)
    ? adminRosterCache
    : [];
} else {
  roster =
    typeof window.getHostRoster === "function"
      ? window.getHostRoster()
      : [];
}

if (!roster.length) {
  setStatus(
    isAdmin
      ? "先に大会名簿CSVを読み込んでください"
      : "保存する名簿がありません"
  );
  return;
}

  await setDoc(
    doc(db, "events", eventId),
    {
      eventId,
      note,
      updatedAt: Date.now()
    },
    { merge: true }
  );

  for (const row of roster) {
    await setDoc(
      doc(db, "events", eventId, "roster", String(row.lane)),
      {
        lane: safe(row.lane),
        bib: safe(row.bib),
        name: safe(row.name),
        team: safe(row.team),
        updatedAt: Date.now()
      },
      { merge: true }
    );
  }

  setStatus(`保存しました: ${eventId} / ${roster.length}件`);
  await loadSavedEvents();
}

async function loadRoster(eventIdArg = "") {
  const eventId =
    onlyDigits(
      eventIdArg ||
      byId("fbEventId")?.value
    );

  if (!/^\d{10}$/.test(eventId)) {
    setStatus(
      "大会IDは10桁で入力してください"
    );
    return;
  }

  const isHost =
    location.hash.startsWith("#/host");

  // ========================================
  // 設定係
  // Renderサーバー経由でFirebaseから取得
  // ========================================
  if (isHost) {
    try {
      const params =
        new URLSearchParams(
          location.hash.split("?")[1] || ""
        );

      const token =
        params.get("t") || "";

      if (!token) {
        setStatus(
          "設定係トークンが見つかりません"
        );
        return;
      }

      setStatus("名簿を読み込んでいます...");

      const response =
        await fetch(
          "/api/host/firebase-roster",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify({
              token,
              eventId
            })
          }
        );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message ||
          "名簿を取得できませんでした"
        );
      }

      const roster =
        Array.isArray(data.roster)
          ? data.roster
          : [];

      if (!roster.length) {
        setStatus(
          `名簿がありません: ${eventId}`
        );
        return;
      }

      if (
        typeof window.setHostRoster ===
        "function"
      ) {
        window.setHostRoster(roster);
      }

      setStatus(
        `読込しました: ${eventId} / ${roster.length}件`
      );

      return;

    } catch (e) {
      console.error(
        "[HOST FIREBASE ROSTER]",
        e
      );

      setStatus(
        "読込失敗: " +
        (e?.message || e)
      );

      return;
    }
  }

  // ========================================
  // 管理者
  // 従来どおりFirebaseから直接取得
  // ========================================
  const eventSnap =
    await getDoc(
      doc(db, "events", eventId)
    );

  if (!eventSnap.exists()) {
    setStatus(
      `大会IDが見つかりません: ${eventId}`
    );
    return;
  }

  const eventData =
    eventSnap.data() || {};

  const noteEl = byId("fbNote");

  if (noteEl) {
    noteEl.value =
      safe(eventData.note);
  }

  const snap =
    await getDocs(
      collection(
        db,
        "events",
        eventId,
        "roster"
      )
    );

  const roster =
    snap.docs
      .map(d => d.data())
      .sort(
        (a, b) =>
          (parseInt(a.lane, 10) || 0) -
          (parseInt(b.lane, 10) || 0)
      );

  if (!roster.length) {
    setStatus(
      `名簿がありません: ${eventId}`
    );
    return;
  }

  if (
    typeof window.setHostRoster ===
    "function"
  ) {
    window.setHostRoster(roster);
  }

  setStatus(
    `読込しました: ${eventId} / ${roster.length}件`
  );
}

async function loadSavedEvents() {
  const isHost =
    location.hash.startsWith("#/host");

  // ========================================
  // 設定係
  // Render経由で大会一覧を取得
  // ========================================
  if (isHost) {
    try {
      const params =
        new URLSearchParams(
          location.hash.split("?")[1] || ""
        );

      const token =
        params.get("t") || "";

      if (!token) {
        savedEventsCache = [];
        renderSavedEventsList();
        return;
      }

      setStatus(
        "保存済み大会を読み込んでいます..."
      );

      const response =
        await fetch(
          "/api/host/firebase-events",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify({
              token
            })
          }
        );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message ||
          "大会一覧を取得できませんでした"
        );
      }

      savedEventsCache =
        Array.isArray(data.events)
          ? data.events
          : [];

      savedEventsCache.sort(
        (a, b) =>
          Number(b.updatedAt || 0) -
          Number(a.updatedAt || 0)
      );

      renderSavedEventsList();

      setStatus(
        "保存済み大会を選択してください"
      );

      return;

    } catch (e) {
      console.error(
        "[HOST FIREBASE EVENTS]",
        e
      );

      savedEventsCache = [];
      renderSavedEventsList();

      setStatus(
        "大会一覧の取得に失敗しました: " +
        (e?.message || e)
      );

      return;
    }
  }

  // ========================================
  // 管理者
  // 従来どおりFirebase Authを使用
  // ========================================


  const snap =
    await getDocs(
      collection(db, "events")
    );

  savedEventsCache =
    snap.docs
      .map(d => {
        const data = d.data() || {};

        return {
          eventId:
            safe(
              data.eventId || d.id
            ),

          note:
            safe(data.note),

          updatedAt:
            Number(
              data.updatedAt || 0
            )
        };
      })
      .sort(
        (a, b) =>
          b.updatedAt - a.updatedAt
      );

  renderSavedEventsList();
}

function renderSavedEventsList() {
  const el = byId("fbSavedList");
  const moreBtn = byId("fbMoreBtn");

  if (!el) return;

  const isHost =
    location.hash.startsWith("#/host");

  // 管理者だけFirebaseログインが必要
  // 設定係はRenderサーバー経由なのでログイン不要
  if (!isHost && !auth.currentUser) {
    el.innerHTML = "未ログイン";

    if (moreBtn) {
      moreBtn.style.display = "none";
    }

    return;
  }

  if (!savedEventsCache.length) {
    el.innerHTML = "保存済みデータはありません";
    if (moreBtn) moreBtn.style.display = "none";
    return;
  }

  const list = savedEventsCache.slice(0, savedEventsVisibleCount);

  el.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>大会ID</th>
          <th>備考</th>
          <th>更新日時</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${list.map(x => `
          <tr>
            <td>${safe(x.eventId)}</td>
            <td>${safe(x.note || "")}</td>
            <td>${x.updatedAt ? new Date(x.updatedAt).toLocaleString("ja-JP") : ""}</td>
            <td>
              <button
                type="button"
                class="secondary"
                data-fb-load="${safe(x.eventId)}"
                data-fb-note="${safe(x.note || "")}"
              >
                読込
              </button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  if (moreBtn) {
    moreBtn.style.display = savedEventsVisibleCount < savedEventsCache.length ? "" : "none";
  }

  bindEvents();
}

function scheduleEnsureFirebaseBox() {
  requestAnimationFrame(() => {
    ensureFirebaseBox();
  });
}
function init() {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      setStatus("ログイン中: " + user.email);

      if (typeof window.setFirebaseLoginState === "function") {
  window.setFirebaseLoginState(true);
}

// app.js の render() でFirebase欄が作り直された後に
// ログイン状態をもう一度表示する
ensureFirebaseBox();
setStatus("ログイン中: " + user.email);

await loadSavedEvents();
    } else {
      setStatus("未ログイン");
      savedEventsCache = [];
      renderSavedEventsList();

      if (typeof window.setFirebaseLoginState === "function") {
        window.setFirebaseLoginState(false);
      }
    }
  });

  scheduleEnsureFirebaseBox();

  const appRoot = document.getElementById("app");
  if (appRoot) {
    const observer = new MutationObserver(() => {
      scheduleEnsureFirebaseBox();
    });

    observer.observe(appRoot, {
      childList: true,
      subtree: true
    });
  }

  window.addEventListener(
  "hashchange",
  async () => {
    scheduleEnsureFirebaseBox();

    if (
      location.hash.startsWith("#/host")
    ) {
      await loadSavedEvents();
    }
  }
);

window.addEventListener(
  "load",
  async () => {
    scheduleEnsureFirebaseBox();

    if (
      location.hash.startsWith("#/host")
    ) {
      await loadSavedEvents();
    }
  }
);
}
window.ensureFirebaseBox = ensureFirebaseBox;
init();
