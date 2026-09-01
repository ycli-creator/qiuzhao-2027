const WHO_KEY = "qiuzhao-2027-who";
const USERS_KEY = "qiuzhao-2027-users";
const LEGACY_STORE = "qiuzhao-2027-status";
const STAMP_PREFIX = "qiuzhao-2027-updated:";
const data = window.QIUZHAO;
const cloudCfg = window.QIUZHAO_CLOUD || {};
const cloud = (cloudCfg.url && cloudCfg.anonKey && window.supabase)
  ? window.supabase.createClient(cloudCfg.url, cloudCfg.anonKey)
  : null;
let who = "";
let mine = {};
let saveGen = 0;

const $ = (id) => document.getElementById(id);
const hiringLabel = {
  open: "在招",
  rolling: "滚动",
  closing: "将截止",
  unknown: "待核"
};

const statusSlug = {
  未投: "idle",
  已投: "sent",
  测评: "eval",
  笔试: "exam",
  一面: "r1",
  二面: "r2",
  三面: "r3",
  HR: "hr",
  意向: "intent",
  Offer: "offer",
  挂: "fail",
  拒: "reject"
};

const filters = {
  q: "",
  industry: "all",
  city: "all",
  hiring: "all",
  mine: "all",
  designOnly: true
};

function storeKey(name) {
  return `${LEGACY_STORE}:${name}`;
}

function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").slice(0, 16);
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function loadUsers() {
  const users = readJson(USERS_KEY, []);
  return Array.isArray(users) ? users.filter(Boolean) : [];
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function hasLegacyProgress() {
  const legacy = readJson(LEGACY_STORE, {});
  return legacy && typeof legacy === "object" && Object.keys(legacy).length > 0;
}

function loadMine(name) {
  const scoped = readJson(storeKey(name), null);
  if (scoped && typeof scoped === "object") return scoped;
  if (!loadUsers().length && hasLegacyProgress()) {
    return readJson(LEGACY_STORE, {});
  }
  return {};
}

function stampKey(name) {
  return STAMP_PREFIX + name;
}

function loadStamp(name) {
  return localStorage.getItem(stampKey(name)) || "";
}

function writeLocal(name, status, iso) {
  localStorage.setItem(storeKey(name), JSON.stringify(status));
  localStorage.setItem(stampKey(name), iso);
}

function setSync(text, kind) {
  const el = $("syncState");
  if (!el) return;
  el.textContent = text;
  el.className = "sync" + (kind ? ` ${kind}` : "");
}

async function listCloudUsers() {
  if (!cloud) return [];
  const { data: rows, error } = await cloud.from("qiuzhao_progress").select("who");
  if (error || !rows) return [];
  return rows.map((row) => row.who).filter(Boolean);
}

async function pullCloud(name) {
  if (!cloud) return null;
  const { data: row, error } = await cloud
    .from("qiuzhao_progress")
    .select("status, updated_at")
    .eq("who", name)
    .maybeSingle();
  if (error) throw error;
  return row;
}

async function pushCloud(name, status, iso) {
  if (!cloud) return false;
  const { error } = await cloud.from("qiuzhao_progress").upsert({
    who: name,
    status,
    updated_at: iso
  });
  if (error) throw error;
  return true;
}

function save() {
  if (!who) return;
  const iso = new Date().toISOString();
  writeLocal(who, mine, iso);
  if (!cloud) {
    setSync("仅本机", "");
    return;
  }
  const gen = ++saveGen;
  setSync("同步中", "pending");
  pushCloud(who, mine, iso)
    .then(() => {
      if (gen === saveGen) setSync("已同步", "ok");
    })
    .catch(() => {
      if (gen === saveGen) setSync("同步失败，已留在本机", "err");
    });
}

async function enterAs(name) {
  const next = normalizeName(name);
  if (!next) return false;
  const users = loadUsers();
  const isFirst = users.length === 0;
  if (!users.includes(next)) {
    users.push(next);
    saveUsers(users);
  }
  who = next;
  mine = loadMine(next);
  if (isFirst && hasLegacyProgress() && !localStorage.getItem(storeKey(next))) {
    writeLocal(next, mine, new Date().toISOString());
  }
  localStorage.setItem(WHO_KEY, next);
  $("gate").hidden = true;
  $("whoBar").hidden = false;
  $("whoName").textContent = next;
  stats();
  render();

  if (!cloud) {
    setSync("仅本机", "");
    return true;
  }

  setSync("读取中", "pending");
  try {
    const remote = await pullCloud(next);
    const remoteStamp = remote?.updated_at || "";
    const localStamp = loadStamp(next);
    const remoteStatus = remote?.status && typeof remote.status === "object" ? remote.status : null;
    if (remoteStatus && (!localStamp || remoteStamp >= localStamp)) {
      mine = remoteStatus;
      writeLocal(next, mine, remoteStamp);
      stats();
      render();
      setSync("已同步", "ok");
    } else if (Object.keys(mine).length) {
      const iso = localStamp || new Date().toISOString();
      await pushCloud(next, mine, iso);
      writeLocal(next, mine, iso);
      setSync("已同步", "ok");
    } else {
      setSync("已同步", "ok");
    }
  } catch {
    setSync("云端读不到，先用本机", "err");
  }
  return true;
}

async function showGate() {
  const names = new Set(loadUsers());
  try {
    (await listCloudUsers()).forEach((name) => names.add(name));
  } catch {
    /* 云端名单读不到就只用本机 */
  }
  $("gateUsers").replaceChildren(
    ...[...names].map((name) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.who = name;
      btn.textContent = name;
      return btn;
    })
  );
  $("gateLegacy").hidden = !(loadUsers().length === 0 && hasLegacyProgress());
  $("gate").hidden = false;
  $("gateName").value = "";
  $("gateName").focus();
}

function isDesignRole(role) {
  return /UX|视觉|动效|品牌|美术|工业/.test(role);
}

function rowVisible(c) {
  if (filters.designOnly && !c.roles.some(isDesignRole)) return false;
  if (filters.industry !== "all" && c.industry !== filters.industry) return false;
  if (filters.hiring !== "all" && c.hiring !== filters.hiring) return false;
  const status = mine[c.id] || "未投";
  if (filters.mine !== "all" && status !== filters.mine) return false;
  if (filters.city !== "all") {
    const wanted = filters.city === "北上广深杭"
      ? ["北京", "上海", "广州", "深圳", "杭州"]
      : [filters.city];
    if (!c.cities.some((city) => wanted.includes(city))) return false;
  }
  if (filters.q) {
    const hay = [c.name, c.industry, c.batch, c.roles.join(" "), c.cities.join(" "), c.note]
      .join(" ")
      .toLowerCase();
    if (!hay.includes(filters.q)) return false;
  }
  return true;
}

function stats() {
  const counts = { 未投: 0, 已投: 0, 流程中: 0, 面试: 0, Offer: 0, 结束: 0 };
  data.companies.forEach((c) => {
    const s = mine[c.id] || "未投";
    if (s === "未投") counts.未投 += 1;
    else if (s === "已投" || s === "测评" || s === "笔试") counts.已投 += 1;
    else if (["一面", "二面", "三面", "HR", "意向"].includes(s)) counts.面试 += 1;
    else if (s === "Offer") counts.Offer += 1;
    else counts.结束 += 1;
    if (!["未投", "挂", "拒"].includes(s)) counts.流程中 += 1;
  });
  $("stats").innerHTML = [
    ["公司", data.companies.length, "all"],
    ["未投", counts.未投, "idle"],
    ["已启动", counts.流程中, "sent"],
    ["面试中", counts.面试, "r1"],
    ["Offer", counts.Offer, "offer"],
    ["挂 / 拒", counts.结束, "fail"]
  ].map(([k, v, slug]) => `<div class="stat s-${slug}"><b>${v}</b><span>${k}</span></div>`).join("");
}

function render() {
  const rows = data.companies.filter(rowVisible);
  $("count").textContent = `显示 ${rows.length} / ${data.companies.length}`;
  if (!rows.length) {
    $("rows").innerHTML = `<tr><td colspan="9" class="empty">没有匹配的公司。关掉「只看设计岗」或清空筛选。</td></tr>`;
    return;
  }
  $("rows").innerHTML = rows.map((c) => {
    const status = mine[c.id] || "未投";
    const slug = statusSlug[status] || "idle";
    const options = data.statuses.map((s) =>
      `<option value="${s}" ${s === status ? "selected" : ""}>${s}</option>`
    ).join("");
    return `
      <tr class="row row-${slug}">
        <td>
          <span class="name">${c.name}</span>
          <span class="sub">${c.tier} · ${c.industry}</span>
        </td>
        <td>${c.batch}<span class="sub">${c.window}</span></td>
        <td><div class="roles">${c.roles.map((r) => `<span class="role">${r}</span>`).join("")}</div></td>
        <td>${c.cities.join(" / ")}</td>
        <td class="hide-sm">${c.test}<span class="sub">笔试：${c.written}</span></td>
        <td class="hide-sm">${c.interview}</td>
        <td><span class="hiring ${c.hiring}">${hiringLabel[c.hiring]}</span><span class="sub">${c.deadline || "截止逐岗"}</span></td>
        <td>
          <select class="mine s-${slug}" data-id="${c.id}" aria-label="${c.name} 我的进度">${options}</select>
        </td>
        <td>
          <a class="site" href="${c.url}" target="_blank" rel="noreferrer">官网</a>
          <span class="sub">${c.note}</span>
        </td>
      </tr>
    `;
  }).join("");
}

function bind() {
  $("q").addEventListener("input", (e) => {
    filters.q = e.target.value.trim().toLowerCase();
    render();
  });
  ["industry", "city", "hiring", "mine"].forEach((key) => {
    $(key).addEventListener("change", (e) => {
      filters[key] = e.target.value;
      render();
    });
  });
  $("designOnly").addEventListener("change", (e) => {
    filters.designOnly = e.target.checked;
    render();
  });
  $("rows").addEventListener("change", (e) => {
    const sel = e.target.closest("select.mine");
    if (!sel) return;
    mine[sel.dataset.id] = sel.value;
    save();
    stats();
    render();
  });
  $("gateForm").addEventListener("submit", (e) => {
    e.preventDefault();
    enterAs($("gateName").value);
  });
  $("gateUsers").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-who]");
    if (btn) enterAs(btn.dataset.who);
  });
  $("switchWho").addEventListener("click", () => {
    showGate();
  });
}

$("checked").textContent = `数据核对日 ${data.checkedAt} · ${data.cohort} · ${data.graduateWindow}`;
$("legend").innerHTML = data.statuses.map((s) => {
  const slug = statusSlug[s] || "idle";
  return `<span class="row-${slug}"><i style="background:var(--row-ink)"></i>${s}</span>`;
}).join("");
bind();

const remembered = normalizeName(localStorage.getItem(WHO_KEY) || "");
if (remembered && loadUsers().includes(remembered)) {
  enterAs(remembered);
} else {
  showGate();
  stats();
  render();
}
