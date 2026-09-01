const STORE = "qiuzhao-2027-status";
const data = window.QIUZHAO;
const mine = JSON.parse(localStorage.getItem(STORE) || "{}");

const $ = (id) => document.getElementById(id);
const hiringLabel = {
  open: "在招",
  rolling: "滚动",
  closing: "将截止",
  unknown: "待核"
};

const filters = {
  q: "",
  industry: "all",
  city: "all",
  hiring: "all",
  mine: "all",
  designOnly: true
};

function save() {
  localStorage.setItem(STORE, JSON.stringify(mine));
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
    ["公司", data.companies.length],
    ["未投", counts.未投],
    ["已启动", counts.流程中],
    ["面试中", counts.面试],
    ["Offer", counts.Offer],
    ["挂 / 拒", counts.结束]
  ].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join("");
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
    const options = data.statuses.map((s) =>
      `<option value="${s}" ${s === status ? "selected" : ""}>${s}</option>`
    ).join("");
    return `
      <tr class="${status === "挂" || status === "拒" ? "dim" : ""}">
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
          <select class="mine ${status}" data-id="${c.id}" aria-label="${c.name} 我的进度">${options}</select>
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
}

$("checked").textContent = `数据核对日 ${data.checkedAt} · ${data.cohort} · ${data.graduateWindow}`;
stats();
bind();
render();
