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
let sessionPin = "";
let sessionSalt = null;
let sessionKey = null;
let pendingName = "";
let pinMode = "create";

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
  role: "design",
  mine: "all"
};

const extraRolesByIndustry = {
  互联网: ["产品", "研发", "运营"],
  游戏: ["产品", "研发"],
  金融: ["产品", "研发"],
  硬件: ["产品", "研发"],
  汽车: ["产品", "研发"],
  芯片: ["研发"],
  外企: ["产品", "研发"],
  国企: ["产品", "研发"]
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

function isVault(value) {
  return Boolean(value && value._enc === 1 && value.ct && value.iv && value.salt);
}

function isPlainStatus(value) {
  return Boolean(value && typeof value === "object" && !isVault(value) && !Array.isArray(value));
}

function loadStored(name) {
  const scoped = readJson(storeKey(name), null);
  if (scoped && typeof scoped === "object") return scoped;
  if (!loadUsers().length && hasLegacyProgress()) {
    return readJson(LEGACY_STORE, {});
  }
  return null;
}

function bytesToB64(bytes) {
  let bin = "";
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin);
}

function b64ToBytes(text) {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(pin, salt, name) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${name}:${pin}`),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptStatus(status, pin, name, saltBytes) {
  const salt = saltBytes || crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt, name);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(status))
  );
  return {
    vault: {
      _enc: 1,
      salt: bytesToB64(salt),
      iv: bytesToB64(iv),
      ct: bytesToB64(new Uint8Array(ct))
    },
    salt,
    key
  };
}

async function decryptStatus(vault, pin, name) {
  const salt = b64ToBytes(vault.salt);
  const iv = b64ToBytes(vault.iv);
  const key = await deriveKey(pin, salt, name);
  const raw = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    b64ToBytes(vault.ct)
  );
  const parsed = JSON.parse(new TextDecoder().decode(raw));
  if (!parsed || typeof parsed !== "object") throw new Error("bad vault");
  return { status: parsed, salt, key };
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function validPin(value) {
  return /^\d{8}$/.test(value);
}

function canCrypto() {
  return Boolean(window.crypto && window.crypto.subtle);
}

function stampKey(name) {
  return STAMP_PREFIX + name;
}

function loadStamp(name) {
  return localStorage.getItem(stampKey(name)) || "";
}

function writeLocal(name, vault, iso) {
  localStorage.setItem(storeKey(name), JSON.stringify(vault));
  localStorage.setItem(stampKey(name), iso);
}

function clearPlainCaches(name) {
  const stored = name ? readJson(storeKey(name), null) : null;
  if (isPlainStatus(stored)) localStorage.removeItem(storeKey(name));
  localStorage.removeItem(LEGACY_STORE);
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
  if (!who || !sessionPin) return;
  const iso = new Date().toISOString();
  const gen = ++saveGen;
  setSync("同步中", "pending");
  encryptStatus(mine, sessionPin, who, sessionSalt)
    .then(async ({ vault, salt, key }) => {
      sessionSalt = salt;
      sessionKey = key;
      writeLocal(who, vault, iso);
      if (cloud) await pushCloud(who, vault, iso);
      if (gen === saveGen) setSync(cloud ? "已同步" : "仅本机", cloud ? "ok" : "");
    })
    .catch(() => {
      if (gen === saveGen) setSync("同步失败，已留在本机", "err");
    });
}

function resetSession() {
  who = "";
  mine = {};
  sessionPin = "";
  sessionSalt = null;
  sessionKey = null;
  pendingName = "";
  $("whoBar").hidden = true;
}

function showPinError(text) {
  $("pinError").hidden = !text;
  $("pinError").textContent = text || "";
}

function showNameStep() {
  $("nameStep").hidden = false;
  $("pinStep").hidden = true;
  $("pinInput").value = "";
  $("pinConfirm").value = "";
  $("pinConfirm").hidden = true;
  showPinError("");
  $("gateName").focus();
}

async function openPinStep(name) {
  const next = normalizeName(name);
  if (!next) return false;
  if (!canCrypto()) {
    showPinError("");
    window.alert("当前打开方式不支持加密。请用网页链接打开，不要直接双击本地文件。");
    return false;
  }
  pendingName = next;
  let remote = null;
  try {
    remote = await pullCloud(next);
  } catch {
    remote = null;
  }
  const local = loadStored(next);
  const locked = isVault(remote?.status) || isVault(local);
  pinMode = locked ? "unlock" : "create";
  $("nameStep").hidden = true;
  $("pinStep").hidden = false;
  $("pinKicker").textContent = next;
  $("pinTitle").textContent = locked ? "输入 8 位密码" : "设置 8 位密码";
  $("pinLead").textContent = locked
    ? "输入这个名字的 8 位数字密码后才能看和改进度。"
    : "第一次使用，请设一组 8 位数字密码。换电脑也用这一组，请自己记住。";
  $("pinConfirm").hidden = locked;
  $("pinInput").value = "";
  $("pinConfirm").value = "";
  $("pinSubmit").textContent = locked ? "进入" : "创建并进入";
  showPinError("");
  $("pinInput").focus();
  return true;
}

function rememberUser(name) {
  const users = loadUsers();
  if (!users.includes(name)) {
    users.push(name);
    saveUsers(users);
  }
  localStorage.setItem(WHO_KEY, name);
}

function revealWorkspace(name) {
  who = name;
  rememberUser(name);
  $("gate").hidden = true;
  $("whoBar").hidden = false;
  $("whoName").textContent = name;
  stats();
  render();
}

async function unlockWithPin(pin) {
  const name = pendingName;
  if (!validPin(pin)) {
    showPinError("请输入 8 位数字");
    return false;
  }
  if (pinMode === "create" && pin !== $("pinConfirm").value) {
    showPinError("两次密码不一致");
    return false;
  }

  let remote = null;
  try {
    remote = await pullCloud(name);
  } catch {
    remote = null;
  }
  const local = loadStored(name);
  const remoteVault = isVault(remote?.status) ? remote.status : null;
  const localVault = isVault(local) ? local : null;
  const remotePlain = isPlainStatus(remote?.status) ? remote.status : null;
  const localPlain = isPlainStatus(local) ? local : null;
  const remoteStamp = remote?.updated_at || "";
  const localStamp = loadStamp(name);

  try {
    if (remoteVault || localVault) {
      const preferRemote = Boolean(remoteVault) && (!localVault || !localStamp || remoteStamp >= localStamp);
      const chosen = preferRemote ? remoteVault : (localVault || remoteVault);
      const opened = await decryptStatus(chosen, pin, name);
      mine = opened.status;
      sessionPin = pin;
      sessionSalt = opened.salt;
      sessionKey = opened.key;
    } else {
      mine = remotePlain || localPlain || {};
      const packed = await encryptStatus(mine, pin, name);
      sessionPin = pin;
      sessionSalt = packed.salt;
      sessionKey = packed.key;
      const iso = new Date().toISOString();
      writeLocal(name, packed.vault, iso);
      if (cloud) await pushCloud(name, packed.vault, iso);
    }
  } catch {
    showPinError("密码不对");
    return false;
  }

  clearPlainCaches(name);
  revealWorkspace(name);
  if (remoteVault || localVault) {
    setSync(cloud ? "已同步" : "仅本机", cloud ? "ok" : "");
    save();
  } else {
    setSync(cloud ? "已同步" : "仅本机", cloud ? "ok" : "");
  }
  return true;
}

async function showGate() {
  resetSession();
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
  showNameStep();
  stats();
  render();
}

function isDesignRole(role) {
  return /UX|视觉|动效|品牌|美术|工业/.test(role);
}

function inferredRoles(c) {
  return (extraRolesByIndustry[c.industry] || []).filter((role) => !c.roles.includes(role));
}

function allRoles(c) {
  return c.roles.concat(inferredRoles(c));
}

function rowVisible(c) {
  const roles = allRoles(c);
  if (filters.role === "design" && !roles.some(isDesignRole)) return false;
  if (filters.role !== "all" && filters.role !== "design" && !roles.includes(filters.role)) return false;
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
    const hay = [c.name, c.industry, c.batch, roles.join(" "), c.cities.join(" "), c.note]
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
    $("rows").innerHTML = `<tr><td colspan="9" class="empty">没有匹配的公司。把岗位改成「全部岗位」或清空筛选。</td></tr>`;
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
        <td><div class="roles">${c.roles.map((r) => `<span class="role">${r}</span>`).join("")}${inferredRoles(c).map((r) => `<span class="role inferred">${r}</span>`).join("")}</div></td>
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
  ["industry", "city", "hiring", "role", "mine"].forEach((key) => {
    $(key).addEventListener("change", (e) => {
      filters[key] = e.target.value;
      render();
    });
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
    openPinStep($("gateName").value);
  });
  $("gateUsers").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-who]");
    if (btn) openPinStep(btn.dataset.who);
  });
  $("switchWho").addEventListener("click", () => {
    showGate();
  });
  ["pinInput", "pinConfirm"].forEach((id) => {
    $(id).addEventListener("input", (e) => {
      e.target.value = digitsOnly(e.target.value);
    });
  });
  $("pinForm").addEventListener("submit", (e) => {
    e.preventDefault();
    $("pinSubmit").disabled = true;
    unlockWithPin($("pinInput").value)
      .finally(() => {
        $("pinSubmit").disabled = false;
      });
  });
  $("pinBack").addEventListener("click", showNameStep);
}

$("checked").textContent = `数据核对日 ${data.checkedAt} · ${data.cohort} · ${data.graduateWindow}`;
$("legend").innerHTML = data.statuses.map((s) => {
  const slug = statusSlug[s] || "idle";
  return `<span class="row-${slug}"><i style="background:var(--row-ink)"></i>${s}</span>`;
}).join("");
bind();
showGate();
