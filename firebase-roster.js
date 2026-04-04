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
  apiKey: "AIzaSyBYOAGmD4O5In_C9q3-IFIeOz-X4YI-gNI",
  authDomain: "racewalk-system.firebaseapp.com",
  projectId: "racewalk-system"
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
  const mount = byId("firebaseMount");
  if (!mount) return;

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
    <div class="big">Firebase 名簿保存</div>

    <div class="row">
      <input id="fbEmail" type="email" placeholder="メールアドレス">
      <input id="fbPassword" type="password" placeholder="パスワード">
      <button id="fbLoginBtn" type="button">ログイン</button>
      <button id="fbLogoutBtn" type="button">ログアウト</button>
    </div>

    <div class="row">
      <input id="fbEventId" type="text" inputmode="numeric" maxlength="10" placeholder="大会ID（10桁）">
      <button id="fbSaveBtn" type="button">現在の名簿をFirebase保存</button>
      <button id="fbLoadBtn" type="button">Firebaseから読込</button>
    </div>

    <div id="fbStatus">未ログイン</div>
  `;

  mount.appendChild(box);
  bindEvents();
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

function init() {
  ensureFirebaseBox();
  onAuthStateChanged(auth, (user) => {
    if (user) {
      setStatus(`ログイン中: ${user.email}`);
    } else {
      setStatus("未ログイン");
    }
  });
}

init();
