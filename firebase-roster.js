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

      console.log("[FB LOGIN] start", { email });

      const cred = await signInWithEmailAndPassword(auth, email, password);

      console.log("[FB LOGIN] success", cred.user?.email);
      setStatus("ログイン成功: " + (cred.user?.email || ""));
    } catch (e) {
      console.error("[FB LOGIN] error", e);
      setStatus("ログイン失敗: " + (e?.code || "") + " " + (e?.message || e));
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
        await loadRoster();
      } catch (e) {
        console.error(e);
        setStatus("読込失敗: " + (e?.message || e));
      }
    };
  }
}
function init() {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      setStatus("ログイン中: " + user.email);

      if (typeof window.setFirebaseLoginState === "function") {
        window.setFirebaseLoginState(true);
      }
    } else {
      setStatus("未ログイン");

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

  window.addEventListener("hashchange", () => {
    scheduleEnsureFirebaseBox();
  });

  window.addEventListener("load", () => {
    scheduleEnsureFirebaseBox();
  });
}
window.ensureFirebaseBox = ensureFirebaseBox;
init();
