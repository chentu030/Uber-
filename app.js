const PRICE_PRESETS = [45, 50, 55, 60, 65, 70, 75];
const MARKUPS = [8, 9, 10];
const FEE_PRESETS = [0, 10, 15, 20];
const DELIVERY_PRESETS = [0, 15, 19, 25, 35, 49];
const CAPS = [
  { id: "none", label: "無上限", value: null },
  { id: "50", label: "$50", value: 50 },
  { id: "60", label: "$60", value: 60 },
  { id: "80", label: "$80", value: 80 },
  { id: "100", label: "$100", value: 100 },
];

const $ = (id) => document.getElementById(id);

let markupState = 9;
let capState = "none";

function parseNum(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function money(n) {
  const r = Math.round(n * 10) / 10;
  return r % 1 === 0 ? `$${r}` : `$${r.toFixed(1)}`;
}

function meetsMin(subtotal, minSpend, minInclusive) {
  return minInclusive ? subtotal >= minSpend : subtotal > minSpend;
}

function readInputs() {
  const store = Math.max(0, parseNum($("store").value, 55));
  const cap = CAPS.find((c) => c.id === capState) ?? CAPS[0];
  return {
    store,
    markup: markupState,
    platform: store + markupState,
    fee: Math.max(0, parseNum($("fee").value, 15)),
    delivery: Math.max(0, parseNum($("delivery").value, 25)),
    minSpend: Math.max(0, parseNum($("min").value, 79)),
    minInclusive: $("min-inclusive").checked,
    rate: Math.min(1, Math.max(0, parseNum($("rate").value, 40) / 100)),
    cap: cap.value,
    coupons: Math.max(1, Math.round(parseNum($("coupons").value, 4))),
    allowStore: $("allow-store").checked,
  };
}

function uberOrder(cups, p) {
  const subtotal = cups * p.platform;
  const qualifies = meetsMin(subtotal, p.minSpend, p.minInclusive);
  let discount = 0;
  if (qualifies) {
    discount = subtotal * p.rate;
    if (p.cap != null) discount = Math.min(discount, p.cap);
  }
  return {
    cups,
    channel: "uber",
    subtotal,
    discount,
    fee: p.fee,
    delivery: p.delivery,
    extras: p.fee + p.delivery,
    pay: subtotal - discount + p.fee + p.delivery,
    qualifies,
  };
}

function storeOrder(cups, p) {
  const pay = cups * p.store;
  return {
    cups,
    channel: "store",
    subtotal: pay,
    discount: 0,
    fee: 0,
    delivery: 0,
    extras: 0,
    pay,
    qualifies: false,
  };
}

function partitions(n, maxParts) {
  const out = [];
  const walk = (left, maxPart, acc) => {
    if (left === 0) {
      out.push(acc.slice());
      return;
    }
    if (acc.length >= maxParts) return;
    for (let i = Math.min(maxPart, left); i >= 1; i--) {
      acc.push(i);
      walk(left - i, i, acc);
      acc.pop();
    }
  };
  walk(n, n, []);
  return out;
}

function planFromOrders(id, orders) {
  return {
    id,
    orders,
    pay: orders.reduce((s, o) => s + o.pay, 0),
    couponsUsed: orders.filter((o) => o.channel === "uber" && o.qualifies).length,
  };
}

function describePlan(plan) {
  const uber = plan.orders.filter((o) => o.channel === "uber");
  const storeCups = plan.orders.filter((o) => o.channel === "store").reduce((s, o) => s + o.cups, 0);
  const groups = new Map();
  for (const o of uber) {
    const key = `${o.cups}:${o.qualifies ? "y" : "n"}`;
    const prev = groups.get(key);
    if (prev) prev.count += 1;
    else groups.set(key, { cups: o.cups, qualifies: o.qualifies, count: 1 });
  }
  const bits = [];
  for (const g of groups.values()) {
    const tag = g.qualifies ? "用券" : "無券";
    bits.push(
      g.count === 1
        ? `Uber 一單 ${g.cups} 杯（${tag}）`
        : `Uber ${g.count} 單各 ${g.cups} 杯（${tag}）`,
    );
  }
  if (storeCups > 0) bits.push(`店內 ${storeCups} 杯`);
  return bits.join(" + ") || "店內自取";
}

function better(a, b) {
  if (a.pay < b.pay - 0.05) return a;
  if (b.pay < a.pay - 0.05) return b;
  if (a.orders.length !== b.orders.length) return a.orders.length < b.orders.length ? a : b;
  return a.couponsUsed <= b.couponsUsed ? a : b;
}

function allPlans(n, p) {
  const plans = [];
  if (p.allowStore) plans.push(planFromOrders("store", [storeOrder(n, p)]));
  const maxUberParts = Math.min(p.coupons, n);
  for (let storeCups = 0; storeCups <= (p.allowStore ? n : 0); storeCups++) {
    const uberCups = n - storeCups;
    if (uberCups === 0) continue;
    for (const parts of partitions(uberCups, Math.max(1, maxUberParts))) {
      const orders = parts.map((c) => uberOrder(c, p));
      if (storeCups > 0) orders.push(storeOrder(storeCups, p));
      const used = orders.filter((o) => o.channel === "uber" && o.qualifies).length;
      if (used > p.coupons) continue;
      plans.push(planFromOrders(`u${parts.join("-")}${storeCups ? `s${storeCups}` : ""}`, orders));
    }
  }
  return plans;
}

function oneShot(n, p) {
  return planFromOrders("oneshot", [uberOrder(n, p)]);
}

function bestPlan(n, p) {
  return allPlans(n, p).reduce((a, b) => better(a, b));
}

function minCupsForCoupon(p) {
  for (let k = 1; k <= 8; k++) {
    if (meetsMin(k * p.platform, p.minSpend, p.minInclusive)) return k;
  }
  return 9;
}

function saveLabel(storePay, bestPay) {
  const save = storePay - bestPay;
  if (Math.abs(save) < 0.05) return { text: "跟店內打平", cls: "" };
  if (save > 0) return { text: `比店內少 ${money(save)}`, cls: "save" };
  return { text: `比店內多 ${money(-save)}`, cls: "lose" };
}

function reasonText(r, p) {
  const extras = p.fee + p.delivery;
  const need = minCupsForCoupon(p);
  if (r.n < need && p.allowStore) {
    return `平台 ${r.n} 杯小計 ${money(r.n * p.platform)}，${p.minInclusive ? "未滿" : "沒超過"} ${money(p.minSpend)}，券用不了。走去店裡 ${money(r.store.pay)} 最便宜。Uber 還要再加服務費 ${money(p.fee)} + 運費 ${money(p.delivery)}。`;
  }
  if (describePlan(r.best) === describePlan(r.shot)) {
    const save = r.store.pay - r.shot.pay;
    return `一次點完就能用券。拆單折扣不會變多，卻要再付一輪服務費+運費（${money(extras)}）。${save > 0.05 ? `比走路去店裡少 ${money(save)}。` : "這次未必贏過店內。"}`;
  }
  if (r.best.couponsUsed >= 2) {
    return `單張折扣碰到上限，拆成 ${r.best.couponsUsed} 單才能多折。記住每一單都要再付服務費+運費。最惠 ${money(r.best.pay)}，一次點完 ${money(r.shot.pay)}。`;
  }
  if (r.best.orders.some((o) => o.channel === "store")) {
    return `一部分改店內更划算。最惠 ${money(r.best.pay)}，一次全 Uber ${money(r.shot.pay)}，全店內 ${money(r.store.pay)}。`;
  }
  return `最惠實付 ${money(r.best.pay)}。`;
}

function chips(host, items, selected, key, onPick) {
  host.innerHTML = "";
  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip" + (String(item.value) === String(selected) ? " on" : "");
    btn.dataset[key] = item.value;
    btn.textContent = item.label;
    btn.addEventListener("click", () => onPick(item.value));
    host.appendChild(btn);
  }
}

function renderChips(p) {
  chips(
    $("store-chips"),
    PRICE_PRESETS.map((n) => ({ value: n, label: `$${n}` })),
    p.store,
    "store",
    (v) => {
      $("store").value = String(v);
      render();
    },
  );
  chips(
    $("markup-chips"),
    MARKUPS.map((n) => ({ value: n, label: `+$${n}` })),
    markupState,
    "markup",
    (v) => {
      markupState = Number(v);
      render();
    },
  );
  chips(
    $("cap-chips"),
    CAPS.map((c) => ({ value: c.id, label: c.label })),
    capState,
    "cap",
    (v) => {
      capState = String(v);
      render();
    },
  );
  chips(
    $("fee-chips"),
    FEE_PRESETS.map((n) => ({ value: n, label: n === 0 ? "免服務費" : `$${n}` })),
    FEE_PRESETS.includes(p.fee) ? p.fee : "",
    "fee",
    (v) => {
      $("fee").value = String(v);
      render();
    },
  );
  chips(
    $("delivery-chips"),
    DELIVERY_PRESETS.map((n) => ({ value: n, label: n === 0 ? "免運" : `$${n}` })),
    DELIVERY_PRESETS.includes(p.delivery) ? p.delivery : "",
    "delivery",
    (v) => {
      $("delivery").value = String(v);
      render();
    },
  );
}

function render() {
  const p = readInputs();
  renderChips(p);
  const cupsNeeded = minCupsForCoupon(p);
  const rows = [1, 2, 3, 4].map((n) => ({
    n,
    store: planFromOrders("store", [storeOrder(n, p)]),
    shot: oneShot(n, p),
    best: bestPlan(n, p),
  }));
  const best2 = rows[1].best;
  const save2 = rows[1].store.pay - best2.pay;
  const extras = p.fee + p.delivery;

  $("stats").innerHTML = `
    <div class="stat"><b>${money(p.platform)}</b><span>平台單杯售價</span></div>
    <div class="stat"><b>${cupsNeeded > 8 ? "—" : `${cupsNeeded} 杯`}</b><span>${p.minInclusive ? "滿" : "超過"} ${money(p.minSpend)} 最少杯數</span></div>
    <div class="stat ${save2 > 0.05 ? "good" : "bad"}"><b>${money(best2.pay)}</b><span>2 杯最惠 · 每單雜費 ${money(extras)}</span></div>
  `;

  const notes = [];
  notes.push({
    cls: p.cap == null ? "plain" : "warn",
    title: p.cap == null ? "沒有折扣上限時，4 張券拆單只會更痛" : `已套用單張最高折抵 ${money(p.cap)}`,
    body:
      p.cap == null
        ? `40% 拆兩單加起來，還是 40%。可是服務費 ${money(p.fee)} 加運費 ${money(p.delivery)} 會收第二次。同一批飲料，能過門檻就併一單。`
        : `一單折不滿時，拆單才可能把券用完。每一單仍要過門檻，也仍要付服務費+運費。`,
  });
  if (cupsNeeded >= 2 && p.allowStore) {
    const one = uberOrder(1, p);
    notes.push({
      cls: "",
      title: "只想喝 1 杯：不要為了用券硬加點",
      body: `平台 ${money(p.platform)} ${p.minInclusive ? "未滿" : "沒超過"} ${money(p.minSpend)}，實付 ${money(one.pay)}，比店內多 ${money(one.pay - p.store)}。加到 ${cupsNeeded} 杯才可能翻盤——第二杯你也要喝才算。`,
    });
  }
  $("notes").innerHTML = notes
    .map((n) => `<aside class="note ${n.cls}"><strong>${n.title}</strong>${n.body}</aside>`)
    .join("");

  $("tickets").innerHTML = rows
    .map((r) => {
      const vs = saveLabel(r.store.pay, r.best.pay);
      const win = r.best.pay < r.store.pay - 0.05;
      return `
        <article class="ticket ${win ? "win" : ""}">
          <div class="kicker"><span>${r.n} 杯</span>${win ? '<span class="stamp">最惠</span>' : "<span>建議</span>"}</div>
          <h3>${describePlan(r.best)}</h3>
          <div class="pay">${money(r.best.pay)}</div>
          <div class="per">每杯 ${money(r.best.pay / r.n)} · 用券 ${r.best.couponsUsed} 張</div>
          <div class="vs">店內 ${money(r.store.pay)} · 一次點 ${money(r.shot.pay)}${r.shot.orders[0].qualifies ? "" : "（無券）"}<br><span class="${vs.cls}">${vs.text}</span></div>
        </article>
      `;
    })
    .join("");

  $("compare-table").querySelector("tbody").innerHTML = rows
    .map((r) => {
      const vs = saveLabel(r.store.pay, r.best.pay);
      const cls = r.store.pay - r.best.pay > 0.05 ? "win" : r.best.pay - r.store.pay > 0.05 ? "lose" : "";
      return `<tr class="${cls}">
        <td>${r.n} 杯</td>
        <td>${describePlan(r.best)}</td>
        <td>${money(r.best.pay)}</td>
        <td>${money(r.best.pay / r.n)}</td>
        <td>${money(r.store.pay)}</td>
        <td>${money(r.shot.pay)}${r.shot.orders[0].qualifies ? "" : "（無券）"}</td>
        <td>${vs.text}</td>
        <td>${r.best.couponsUsed}</td>
      </tr>`;
    })
    .join("");

  const maxPay = Math.max(...rows.flatMap((r) => [r.store.pay, r.shot.pay, r.best.pay]), 1);
  $("chart").innerHTML = rows
    .map((r) => {
      const w = (n) => `${Math.max(4, (n / maxPay) * 100)}%`;
      return `
        <div class="bar-row">
          <div class="bar-label"><span>${r.n} 杯</span><span>${money(r.best.pay)}</span></div>
          <div class="tracks">
            <div class="track store" title="店內 ${money(r.store.pay)}"><span style="width:${w(r.store.pay)}"></span></div>
            <div class="track uber" title="一次點 ${money(r.shot.pay)}"><span style="width:${w(r.shot.pay)}"></span></div>
            <div class="track best" title="最惠 ${money(r.best.pay)}"><span style="width:${w(r.best.pay)}"></span></div>
          </div>
        </div>
      `;
    })
    .join("");

  $("details").innerHTML = rows
    .map((r) => {
      const lines = r.best.orders
        .map((o) => {
          const name =
            o.channel === "uber" ? (o.qualifies ? "Uber（用券）" : "Uber（未滿額）") : "店內";
          return `<tr>
            <td>${name}</td><td>${o.cups}</td><td>${money(o.subtotal)}</td>
            <td>${o.discount > 0 ? `−${money(o.discount)}` : "—"}</td>
            <td>${o.fee > 0 ? money(o.fee) : "—"}</td>
            <td>${o.delivery > 0 ? money(o.delivery) : "—"}</td>
            <td>${money(o.pay)}</td>
          </tr>`;
        })
        .join("");
      return `
        <details class="detail" ${r.n === 2 ? "open" : ""}>
          <summary><span>${r.n} 杯 · ${describePlan(r.best)}</span><b>${money(r.best.pay)}</b></summary>
          <div class="body">
            <div class="table-wrap">
              <table>
                <thead><tr><th>通路</th><th>杯數</th><th>小計</th><th>折抵</th><th>服務費</th><th>運費</th><th>實付</th></tr></thead>
                <tbody>${lines}</tbody>
              </table>
            </div>
            <p>${reasonText(r, p)}</p>
          </div>
        </details>
      `;
    })
    .join("");
}

function bind() {
  ["store", "fee", "delivery", "min", "rate", "coupons"].forEach((id) => {
    $(id).addEventListener("input", render);
  });
  $("allow-store").addEventListener("change", render);
  $("min-inclusive").addEventListener("change", render);
  render();
}

bind();
