// RateBoli — frontend (Roman Urdu UI)
const $ = (id) => document.getElementById(id);
const state = { user: null, token: localStorage.getItem('rb_token') || null, socket: null };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n).toLocaleString('en-US');
const ago = (iso) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'abhi';
  if (s < 3600) return Math.floor(s / 60) + ' min pehle';
  if (s < 86400) return Math.floor(s / 3600) + ' ghante pehle';
  return Math.floor(s / 86400) + ' din pehle';
};
const fmtDate = (iso) => {
  const p = String(iso).split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(p[2])} ${months[Number(p[1]) - 1]} ${p[0]}`;
};
const readAsDataURL = (file) => new Promise((res, rej) => {
  if (!file) return res('');
  const fr = new FileReader();
  fr.onload = () => res(fr.result);
  fr.onerror = () => rej(new Error('Tasveer parhi nahi ja saki'));
  fr.readAsDataURL(file);
});

async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Kuch ghalat ho gaya');
  return data;
}

function show(id) {
  for (const s of ['screen-auth', 'screen-main', 'screen-detail']) $(s).classList.add('hidden');
  $(id).classList.remove('hidden');
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 5000);
}

// ---------- Auth ----------
function initAuth() {
  $('tab-login').onclick = () => {
    $('tab-login').classList.add('active'); $('tab-register').classList.remove('active');
    $('pane-login').classList.remove('hidden'); $('pane-register').classList.add('hidden');
  };
  $('tab-register').onclick = () => {
    $('tab-register').classList.add('active'); $('tab-login').classList.remove('active');
    $('pane-register').classList.remove('hidden'); $('pane-login').classList.add('hidden');
  };
  $('btn-login').onclick = async () => {
    $('auth-err').textContent = '';
    try {
      const { user, token } = await api('/api/login', 'POST', { phone: $('login-phone').value });
      saveSession(user, token);
    } catch (e) { $('auth-err').textContent = e.message; }
  };
  $('btn-register').onclick = async () => {
    $('auth-err').textContent = '';
    try {
      const { user, token } = await api('/api/register', 'POST', {
        name: $('reg-name').value, phone: $('reg-phone').value,
      });
      saveSession(user, token);
    } catch (e) { $('auth-err').textContent = e.message; }
  };
}
function saveSession(user, token) {
  state.user = user; state.token = token;
  localStorage.setItem('rb_token', token);
  enterApp();
}
function logout() {
  state.user = null; state.token = null;
  localStorage.removeItem('rb_token');
  if (state.socket) { state.socket.disconnect(); state.socket = null; }
  show('screen-auth');
}

// ---------- App shell ----------
function enterApp() {
  $('user-chip').textContent = state.user.name;
  show('screen-main');
  connectSocket();
  refreshBell();
  renderMain();
}

function connectSocket() {
  if (state.socket) state.socket.disconnect();
  state.socket = io({ auth: { token: state.token } });
  state.socket.on('notification', (n) => {
    toast('🔔 ' + n.text);
    refreshBell();
    refreshList();
  });
}

async function refreshBell() {
  try {
    const { notifications } = await api('/api/notifications');
    const unread = notifications.filter(n => !n.read).length;
    const b = $('bell-badge');
    b.textContent = unread;
    b.classList.toggle('hidden', unread === 0);
  } catch { /* ignore */ }
}

function refreshList() {
  if (!state.user) return;
  loadLists();
}

// ---------- Main (demand bhejo + boli lagao — ek hi account se dono kaam) ----------
function renderMain() {
  $('main-content').innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">Nayi Demand</h2>
      <div id="d-items"></div>
      <datalist id="units">
        <option value="kg"></option><option value="gram"></option><option value="litre"></option>
        <option value="piece"></option><option value="dozen"></option><option value="carton"></option>
        <option value="packet"></option><option value="bori"></option>
      </datalist>
      <button class="btn ghost" id="btn-add-item" type="button">＋ Ek aur product</button>
      <label>Note (optional)<input id="d-note" placeholder="koi khaas baat"></label>
      <label>Aakhri tareekh — is ke baad boli nahi lagegi (optional)<input id="d-deadline" type="date"></label>
      <button class="btn primary" id="btn-demand">Demand Bhejein</button>
      <p class="err" id="d-err"></p>
    </div>
    <h2>Meri Demands</h2>
    <div id="my-demand-list"><p class="empty">Load ho raha hai…</p></div>
    <h2>Doosron ki Khuli Demands</h2>
    <p class="muted" style="margin:0 4px 10px">Kisi demand par apni boli lagayein — aap ki boli doosron ko nazar <b>nahi</b> aayegi.</p>
    <div id="other-demand-list"><p class="empty">Load ho raha hai…</p></div>`;
  const addItemRow = (canRemove) => {
    const row = document.createElement('div');
    row.className = 'd-item-row';
    row.innerHTML = `
      <label>Product ka naam<input class="di-product" placeholder="masalan: Cheeni"></label>
      <div class="row">
        <label>Miqdar<input class="di-qty" type="number" min="1" placeholder="50"></label>
        <label>Unit<input class="di-unit" list="units" placeholder="kg"></label>
      </div>
      <label>📷 Tasveer (optional)<input type="file" class="di-image" accept="image/*"></label>
      <img class="di-preview hidden" style="max-width:120px;border-radius:8px;margin-bottom:8px" alt="">
      ${canRemove ? '<button type="button" class="link di-remove">✕ Ye product hatayein</button>' : ''}`;
    if (canRemove) row.querySelector('.di-remove').onclick = () => row.remove();
    const fi = row.querySelector('.di-image'), pv = row.querySelector('.di-preview');
    fi.onchange = () => {
      const f = fi.files[0];
      if (!f) { pv.classList.add('hidden'); pv.src = ''; return; }
      const fr = new FileReader();
      fr.onload = () => { pv.src = fr.result; pv.classList.remove('hidden'); };
      fr.readAsDataURL(f);
    };
    $('d-items').appendChild(row);
  };
  addItemRow(false);
  $('btn-add-item').onclick = () => addItemRow(true);
  $('btn-demand').onclick = async () => {
    $('d-err').textContent = '';
    try {
      const rows = [...document.querySelectorAll('#d-items .d-item-row')];
      const items = [];
      for (const row of rows) {
        const name = row.querySelector('.di-product').value;
        if (!String(name).trim()) continue;
        const file = row.querySelector('.di-image').files[0];
        items.push({
          product_name: name,
          quantity: row.querySelector('.di-qty').value,
          unit: row.querySelector('.di-unit').value,
          image: await readAsDataURL(file),
        });
      }
      if (!items.length) throw new Error('Kam az kam ek product ka naam likhein');
      const { demands } = await api('/api/demands', 'POST', {
        items,
        note: $('d-note').value,
        deadline: $('d-deadline').value,
      });
      renderMain();
      toast(`✅ ${demands.length} demand${demands.length > 1 ? 'ein' : ''} sab ko bhej di gayin`);
      loadLists();
    } catch (e) { $('d-err').textContent = e.message; }
  };
  loadLists();
}

function demandCard(d, mine) {
  const lowestHtml = d.lowest
    ? `<div class="lowest-box">Sab se kam: <span class="big">Rs ${fmt(d.lowest.rate)}</span>
       <span class="muted">/ ${esc(d.unit || 'unit')} • kul: Rs ${fmt(d.lowest.rate * d.quantity)}</span></div>`
    : `<div class="d-meta" style="margin-top:8px">Abhi koi boli nahi aayi</div>`;
  const myBidHtml = d.my_rate != null
    ? `<div class="my-bid">Meri boli: <b>Rs ${fmt(d.my_rate)}</b><span class="muted"> / ${esc(d.unit || 'unit')}</span></div>`
    : (d.status === 'open'
      ? (d.expired
        ? `<div class="d-meta" style="margin-top:8px;color:#a33;font-weight:700">⏰ Muddat khatam — ab boli nahi lag sakti</div>`
        : `<div class="d-meta" style="margin-top:8px;color:#b98a12;font-weight:700">Abhi boli nahi lagayi — kholein aur rate dein</div>`)
      : '');
  const deadlineHtml = d.deadline ? ` • ⏰ ${esc(fmtDate(d.deadline))} tak` : '';
  const thumbHtml = d.image_url
    ? `<a href="${esc(d.image_url)}" target="_blank" onclick="event.stopPropagation()" style="flex-shrink:0"><img src="${esc(d.image_url)}" alt="" style="width:52px;height:52px;object-fit:cover;border-radius:8px"></a>`
    : '';
  return `
    <div class="card demand" data-id="${esc(d.id)}">
      <div class="d-top">${thumbHtml}<b style="flex:1">${esc(d.product_name)}</b>
        <span class="badge static ${d.status}">${d.status === 'open' ? 'Khuli' : 'Band'}</span></div>
      <div class="d-meta">${fmt(d.quantity)}${d.unit ? ' ' + esc(d.unit) : ''} • ${esc(d.shopkeeper_name)} • Boliyan: ${d.bid_count}${deadlineHtml} • ${ago(d.created_at)}</div>
      ${mine ? lowestHtml : myBidHtml}
    </div>`;
}

async function loadLists() {
  const myBox = $('my-demand-list'), otherBox = $('other-demand-list');
  if (!myBox || !otherBox) return;
  try {
    const { demands } = await api('/api/demands');
    const mine = demands.filter(d => d.is_mine);
    const others = demands.filter(d => !d.is_mine);
    myBox.innerHTML = mine.length ? mine.map(d => demandCard(d, true)).join('')
      : '<p class="empty">Abhi koi demand nahi — upar se nayi demand bhejein.</p>';
    otherBox.innerHTML = others.length ? others.map(d => demandCard(d, false)).join('')
      : '<p class="empty">Abhi koi khuli demand nahi hai.</p>';
    document.querySelectorAll('#main-content .demand').forEach(el => el.onclick = () => openDetail(el.dataset.id));
  } catch (e) {
    myBox.innerHTML = `<p class="empty">${esc(e.message)}</p>`;
    otherBox.innerHTML = '';
  }
}

// ---------- Detail ----------
async function openDetail(id) {
  show('screen-detail');
  $('detail-content').innerHTML = '<p class="empty">Load ho raha hai…</p>';
  try {
    const { demand: d } = await api('/api/demands/' + id);
    const u = state.user;
    let html = `
      <div class="card">
        ${d.image_url ? `<a href="${esc(d.image_url)}" target="_blank"><img src="${esc(d.image_url)}" alt="Product ki tasveer" style="width:100%;max-height:240px;object-fit:contain;border-radius:10px;margin-bottom:8px;background:#f2f5f3"></a>` : ''}
        <div class="d-top"><b style="font-size:19px">${esc(d.product_name)}</b>
          <span class="badge static ${d.status}">${d.status === 'open' ? 'Khuli' : 'Band'}</span></div>
        <div class="d-meta">Miqdar: ${fmt(d.quantity)}${d.unit ? ' ' + esc(d.unit) : ''}</div>
        ${d.note ? `<div class="d-meta">Note: ${esc(d.note)}</div>` : ''}
        ${d.deadline ? `<div class="d-meta">⏰ Aakhri tareekh: ${esc(fmtDate(d.deadline))}${d.expired ? ' (muddat khatam)' : ''}</div>` : ''}
        <div class="d-meta">Shopkeeper: ${esc(d.shopkeeper_name)} • ${ago(d.created_at)}</div>
        <div class="d-meta">Kul boliyan: ${d.bid_count} (rates chhupay huay hain)</div>
      </div>`;

    const isMine = d.shopkeeper_id === u.id;
    if (isMine) {
      // Apni demand: sab se kam boli + band karne ka button (khud boli nahi laga sakte)
      if (d.lowest) {
        html += `
        <div class="winner-card">
          <div class="muted">Sab se kam boli</div>
          <div class="big">Rs ${fmt(d.lowest.rate)} <span class="muted" style="font-size:14px">/ ${esc(d.unit || 'unit')}</span></div>
          <div style="margin-top:6px">Kul qeemat: <b>Rs ${fmt(d.lowest.rate * d.quantity)}</b>
            <span class="muted">(${fmt(d.quantity)}${d.unit ? ' ' + esc(d.unit) : ''})</span></div>
          <div style="margin-top:10px">Supplier: <b>${esc(d.lowest.supplier_name)}</b></div>
          <a class="phone-link" href="tel:${esc(d.lowest.supplier_phone)}">📞 ${esc(d.lowest.supplier_phone)} par call karein</a>
        </div>`;
      } else {
        html += '<div class="card"><p class="empty">Abhi koi boli nahi aayi.</p></div>';
      }
      if (d.status === 'open') {
        html += `<button class="btn danger" id="btn-close">Demand Band Karein</button>
                 <p class="muted" style="text-align:center">Band karne ke baad koi nayi boli nahi aa sakegi.</p>`;
      }
    } else {
      // Supplier: sirf apni boli + form (doosron ke rates kabhi nahi)
      html += `
      <div class="card">
        <h2 style="margin-top:0">${d.my_rate != null ? 'Meri Boli (update kar sakte hain)' : 'Meri Boli'}</h2>
        ${d.my_rate != null ? `<div class="my-bid">Maujooda boli: <b>Rs ${fmt(d.my_rate)}</b><span class="muted"> / ${esc(d.unit || 'unit')}</span></div>` : ''}
        ${d.status === 'open' && !d.expired ? `
          <label>Rate — Rs per ${esc(d.unit || 'unit')}<input id="b-rate" type="number" min="1" placeholder="masalan: 135"></label>
          <button class="btn primary" id="btn-bid">${d.my_rate != null ? 'Boli Update Karein' : 'Boli Bhejein'}</button>
          <p class="err" id="b-err"></p>
          <p class="muted" style="text-align:center">Aap ki boli sirf demand banane wale ko nazar aayegi — doosron ko nahi.</p>
        ` : `<p class="empty">${d.expired ? '⏰ Is demand ki muddat khatam ho chuki hai.' : 'Ye demand band ho chuki hai.'}</p>`}
      </div>`;
    }

    $('detail-content').innerHTML = html;
    const bc = $('btn-close');
    if (bc) bc.onclick = async () => {
      if (!confirm('Demand band kar dein?')) return;
      try { await api('/api/demands/' + id + '/close', 'POST'); toast('Demand band ho gayi'); openDetail(id); refreshList(); }
      catch (e) { toast('❌ ' + e.message); }
    };
    const bb = $('btn-bid');
    if (bb) bb.onclick = async () => {
      $('b-err').textContent = '';
      try {
        await api('/api/demands/' + id + '/bids', 'POST', { rate: $('b-rate').value });
        toast('✅ Boli bhej di gayi');
        openDetail(id); refreshList();
      } catch (e) { $('b-err').textContent = e.message; }
    };
  } catch (e) {
    $('detail-content').innerHTML = `<p class="empty">${esc(e.message)}</p>`;
  }
}

// ---------- Notifications ----------
async function openNotifs() {
  $('panel-notif').classList.remove('hidden');
  const box = $('notif-list');
  box.innerHTML = '<p class="empty">Load ho raha hai…</p>';
  try {
    const { notifications } = await api('/api/notifications');
    box.innerHTML = notifications.length
      ? notifications.map(n => `<div class="notif ${n.read ? '' : 'unread'}">${esc(n.text)}<span class="time">${ago(n.created_at)}</span></div>`).join('')
      : '<p class="empty">Koi notification nahi.</p>';
  } catch (e) { box.innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
}

// ---------- Wire up ----------
$('btn-back').onclick = () => { show('screen-main'); refreshList(); };
$('btn-logout').onclick = () => logout();
$('btn-bell').onclick = () => openNotifs();
$('btn-notif-close').onclick = () => $('panel-notif').classList.add('hidden');
$('btn-notif-read').onclick = async () => {
  await api('/api/notifications/read', 'POST');
  refreshBell(); openNotifs();
};

initAuth();
if (state.token) {
  api('/api/me').then(({ user }) => saveSession(user, state.token)).catch(() => logout());
} else {
  show('screen-auth');
}
