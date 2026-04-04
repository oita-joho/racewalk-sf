import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
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
  apiKey: "ここ",
  authDomain: "ここ",
  projectId: "ここ"
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

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
  let box = byId("firebaseBox");
  if (box) return;

  box = document.createElement("div");
  box.id = "firebaseBox";
  box.className = "card";
  box.innerHTML = `
    <h3>Firebase 保存</h3>

    <div>
      <input id="fbEmail" type="email" placeholder="メールアドレス">
      <input id="fbPassword" type="password" placeholder="パスワード">
      <button id="fbLoginBtn" type="button">ログイン</button>
      <button id="fbLogoutBtn" type="button">ログアウト</button>
    </div>

    <div>
      <input id="fbEventId" type="text" inputmode="numeric" maxlength="10" placeholder="大会ID（10桁）">
      <button id="fbSaveBtn" type="button">保存</button>
      <button id="fbLoadBtn" type="button">読込</button>
    </div>

    <div id="fbStatus">未ログイン</div>
  `;

  document.body.prepend(box);
  bindEvents();
}

async function saveRoster() {
  const eventId = onlyDigits(byId("fbEventId")?.value);
  if (!/^\d{10}$/.test(eventId)) {
    setStatus("大会IDは10桁で入力してください");
    return;
  }

  const roster = Array.isArray(window.currentRoster) ? window.currentRoster : [];
  if (!roster.length) {
    setStatus("保存する名簿がありません");
    return;
  }

  await setDoc(
    doc(db, "events", eventId),
    {
      eventId,
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
}

async function loadRoster() {
  const eventId = onlyDigits(byId("fbEventId")?.value);
  if (!/^\d{10}$/.test(eventId)) {
    setStatus("大会IDは10桁で入力してください");
    return;
  }

  const eventSnap = await getDoc(doc(db, "events", eventId));
  if (!eventSnap.exists()) {
    setStatus(`大会IDが見つかりません: ${eventId}`);
    return;
  }

  const snap = await getDocs(collection(db, "events", eventId, "roster"));
  const roster = snap.docs
    .map(d => d.data())
    .sort((a, b) => (parseInt(a.lane, 10) || 0) - (parseInt(b.lane, 10) || 0));

  if (!roster.length) {
    setStatus(`名簿がありません: ${eventId}`);
    return;
  }

  window.currentRoster = roster;

  if (typeof window.render === "function") {
    window.render();
  } else {
    location.reload();
  }

  setStatus(`読込しました: ${eventId} / ${roster.length}件`);
}

function bindEvents() {
  const loginBtn = byId("fbLoginBtn");
  const logoutBtn = byId("fbLogoutBtn");
  const saveBtn = byId("fbSaveBtn");
  const loadBtn = byId("fbLoadBtn");
  const eventIdEl = byId("fbEventId");

  if (eventIdEl && !eventIdEl.dataset.bound) {
    eventIdEl.dataset.bound = "1";
    eventIdEl.addEventListener("input", () => {
      eventIdEl.value = onlyDigits(eventIdEl.value);
    });
  }

  if (loginBtn && !loginBtn.dataset.bound) {
    loginBtn.dataset.bound = "1";
    loginBtn.addEventListener("click", async () => {
      try {
        await signInWithEmailAndPassword(
          auth,
          safe(byId("fbEmail")?.value),
          byId("fbPassword")?.value || ""
        );
      } catch (e) {
        console.error(e);
        setStatus("ログイン失敗: " + (e?.message || e));
      }
    });
  }

  if (logoutBtn && !logoutBtn.dataset.bound) {
    logoutBtn.dataset.bound = "1";
    logoutBtn.addEventListener("click", async () => {
      try {
        await signOut(auth);
      } catch (e) {
        console.error(e);
        setStatus("ログアウト失敗: " + (e?.message || e));
      }
    });
  }

  if (saveBtn && !saveBtn.dataset.bound) {
    saveBtn.dataset.bound = "1";
    saveBtn.addEventListener("click", async () => {
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
    });
  }

  if (loadBtn && !loadBtn.dataset.bound) {
    loadBtn.dataset.bound = "1";
    loadBtn.addEventListener("click", async () => {
      try {
        await loadRoster();
      } catch (e) {
        console.error(e);
        setStatus("読込失敗: " + (e?.message || e));
      }
    });
  }
}

ensureFirebaseBox();

onAuthStateChanged(auth, (user) => {
  if (user) {
    setStatus(`ログイン中: ${user.email}`);
  } else {
    setStatus("未ログイン");
  }
});
