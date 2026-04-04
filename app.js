const app = document.getElementById("app");

// ===== token / role =====
let role = "guest";
let hostToken = "";

(function initRole() {
  const hash = location.hash || "#/host";
  const route = hash.split("?")[0];
  const params = new URLSearchParams(hash.split("?")[1] || "");
  const token = params.get("t") || "";

  hostToken = token;

  if (route === "#/host" && token && token.startsWith("rw_HOST_")) {
    role = "host";
  } else {
    role = "guest";
  }
})();

// ===== state =====
let roster = [];
window.currentRoster = roster;

// ===== util =====
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (ch === ",") {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }

    if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
      continue;
    }

    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
      continue;
    }

    cell += ch;
    i++;
  }

  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows.map(r => r.map(c => String(c ?? "").trim()));
}

function csvRowsToRoster(rows) {
  const cleaned = rows.filter(r => r.some(c => String(c || "").trim() !== ""));
  if (!cleaned.length) return [];

  const h0 = (cleaned[0][0] || "").toLowerCase();
  if (h0 === "lane" || h0 === "レーン" || h0.includes("lane")) {
    cleaned.shift();
  }

  const out = [];
  for (const r of cleaned) {
    const lane = String(r[0] ?? "").trim();
    const bib = String(r[1] ?? "").trim();
    const name = String(r[2] ?? "").trim();
    const team = String(r[3] ?? "").trim();

    if (!lane || !name) continue;
    if (!/^\d+$/.test(lane)) continue;

    out.push({ lane, bib, name, team });
  }

  const map = {};
  for (const a of out) map[String(a.lane)] = a;
  return Object.values(map).sort((a, b) => (parseInt(a.lane, 10) || 0) - (parseInt(b.lane, 10) || 0));
}

// ===== render =====
function render() {
  if (role !== "host") {
    app.innerHTML = `
      <div class="card error">
        アクセス不可です。<br>
        管理者URL（トークン付き）で開いてください。<br><br>
        例：<br>
        <code>#/host?t=rw_HOST_あなたのトークン</code>
      </div>
    `;
    return;
  }

  app.innerHTML = `
    <div class="card">
      <div class="big">CSVから名簿を読み込み</div>
      <div class="notice">
        形式：lane,bib,name,team（1行目ヘッダ可）<br>
        例：1,101,山田太郎,大分高校
      </div>
      <div class="row" style="margin-top:8px;">
        <input id="csvFile" type="file" accept=".csv,text/csv">
        <button id="loadCsvBtn">読み込み</button>
      </div>
    </div>

    <div id="firebaseMount"></div>

    <div class="card">
      <div class="big">名簿一覧（${roster.length}人）</div>
      <table>
        <thead>
          <tr>
            <th>レーン</th>
            <th>番号</th>
            <th>氏名</th>
            <th>所属</th>
          </tr>
        </thead>
        <tbody>
          ${
            roster.length
              ? roster.map(r => `
                <tr>
                  <td>${esc(r.lane)}</td>
                  <td>${esc(r.bib)}</td>
                  <td>${esc(r.name)}</td>
                  <td>${esc(r.team)}</td>
                </tr>
              `).join("")
              : `<tr><td colspan="4">まだ名簿はありません</td></tr>`
          }
        </tbody>
      </table>
    </div>
  `;

  const loadCsvBtn = document.getElementById("loadCsvBtn");
  if (loadCsvBtn) {
    loadCsvBtn.onclick = async () => {
      const file = document.getElementById("csvFile")?.files?.[0];
      if (!file) {
        alert("CSVファイルを選んでください。");
        return;
      }

      const text = await file.text();
      const rows = parseCsv(text);
      roster = csvRowsToRoster(rows);
      window.currentRoster = roster;
      render();
      if (typeof window.ensureFirebaseBox === "function") {
        window.ensureFirebaseBox();
      }
    };
  }
}

window.render = render;
render();
