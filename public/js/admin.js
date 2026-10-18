// ===============================================================
//  管理画面：ご意見・ご要望を読む（管理者パスワードが必要）
//  パスワードはこのタブを閉じると消える sessionStorage にだけ置く
// ===============================================================
const KEY = 'geinin-admin';
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const getPass = () => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } };
const setPass = (v) => { try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY); } catch {} };

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { authorization: `Bearer ${getPass()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `エラー ${res.status}`), { status: res.status });
  return data;
}
const call = (method = 'GET', id) => request(`/api/admin/feedback${id ? `?id=${id}` : ''}`, { method });

function fmtDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function render(items) {
  $('#total').textContent = `（${items.length}件）`;
  $('#items').innerHTML = items.length ? items.map((f) => `
    <article class="fb-item glass" data-id="${f.id}" data-testid="admin-item">
      <div class="meta"><span>${fmtDate(f.created_at)}</span><span>芸名：${esc(f.name || '不明')}</span><span>${esc(f.unit || '')}</span><span>享年${f.age || '-'}</span></div>
      <p class="body">${esc(f.text)}</p>
      <div class="actions"><button type="button" class="copy">コピー</button><button type="button" class="danger del">削除</button></div>
    </article>`).join('') : '<p class="admin-empty glass">まだご意見は届いていません。</p>';
}

// ---------- ランキングの管理（複数選んで削除） ----------
const fmtMan = (man) => {
  const v = Math.round(man); const oku = Math.floor(Math.abs(v) / 10000); const rest = Math.abs(v) % 10000;
  return (v < 0 ? '-' : '') + (oku ? `${oku}億${rest ? rest.toLocaleString() + '万' : ''}円` : `${Math.abs(v).toLocaleString()}万円`);
};
function selectedIds() { return [...document.querySelectorAll('#hof-items input:checked')].map((c) => Number(c.value)); }
function updateSelection() {
  const ids = selectedIds(); const all = document.querySelectorAll('#hof-items input');
  $('#hof-selected').textContent = `${ids.length}件選択中`;
  const del = $('#hof-delete');
  del.disabled = !ids.length; del.dataset.confirm = ''; del.textContent = ids.length ? `選択した${ids.length}件を削除` : '選択したものを削除';
  $('#hof-all').checked = all.length > 0 && ids.length === all.length;
  $('#hof-all').indeterminate = ids.length > 0 && ids.length < all.length;
}
function renderHof(items) {
  $('#hof-total').textContent = `（${items.length}件）`;
  $('#hof-items').innerHTML = items.length ? items.map((e, i) => `
    <li class="glass" data-testid="hof-row">
      <label>
        <input type="checkbox" value="${e.id}" data-testid="hof-check">
        <span class="rk">${i + 1}</span>
        <span class="who">${esc(e.name)}<small>${esc(e.unit)}・${fmtMan(e.lifetime)}・🏆${e.awards}・軍団${e.army}人・享年${e.age}・出演${e.tv ?? 0}本・${fmtDate(e.created_at)}</small></span>
        <b>${Number(e.score).toLocaleString()}点</b>
      </label>
    </li>`).join('') : '<p class="admin-empty glass">ランキングはまだ空です。</p>';
  updateSelection();
}
async function loadHof() { const { items } = await request('/api/admin/hof'); renderHof(items); }

$('#hof-items').addEventListener('change', updateSelection);
$('#hof-all').addEventListener('change', (e) => {
  document.querySelectorAll('#hof-items input').forEach((c) => { c.checked = e.target.checked; });
  updateSelection();
});
$('#hof-delete').addEventListener('click', async (e) => {
  const ids = selectedIds();
  if (!ids.length) return;
  // 誤操作防止：1回目で確認、2回目で削除
  if (e.target.dataset.confirm !== '1') { e.target.dataset.confirm = '1'; e.target.textContent = `本当に${ids.length}件を削除する（元に戻せません）`; return; }
  e.target.disabled = true;
  try {
    const { items, deleted } = await request('/api/admin/hof', { method: 'POST', body: { ids } });
    renderHof(items);
    $('#hof-msg').textContent = `${deleted}件を削除しました。`;
  } catch (err) { $('#hof-msg').textContent = err.message; e.target.disabled = false; }
});
document.querySelectorAll('.admin-tabs button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.admin-tabs button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    const hof = b.dataset.tab === 'hof';
    $('#items').hidden = hof; $('#hof').hidden = !hof;
    $('#hof-msg').textContent = '';
  });
});

async function load() {
  try {
    const [{ items }] = await Promise.all([call(), loadHof()]);
    $('#login').hidden = true; $('#list').hidden = false;
    render(items);
  } catch (e) {
    setPass('');
    $('#list').hidden = true; $('#login').hidden = false;
    $('#login-error').textContent = e.message;
  }
}

$('#login form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#admin-password').value;
  if (!v) { $('#login-error').textContent = 'パスワードを入力してください。'; return; }
  setPass(v); $('#admin-password').value = '';
  load();
});
$('#reload').onclick = load;
$('#logout').onclick = () => { setPass(''); $('#items').innerHTML = ''; $('#hof-items').innerHTML = ''; $('#list').hidden = true; $('#login').hidden = false; $('#login-error').textContent = ''; };
$('#items').addEventListener('click', async (e) => {
  const item = e.target.closest('.fb-item');
  if (!item) return;
  if (e.target.classList.contains('copy')) {
    try { await navigator.clipboard.writeText(item.querySelector('.body').textContent); e.target.textContent = 'コピーしました'; } catch {}
  }
  if (e.target.classList.contains('del')) {
    // 誤操作防止：1回目で確認表示、2回目で削除
    if (e.target.dataset.confirm !== '1') { e.target.dataset.confirm = '1'; e.target.textContent = '本当に削除する'; return; }
    try { await call('DELETE', item.dataset.id); item.remove(); load(); } catch (err) { e.target.textContent = err.message; }
  }
});

if (getPass()) load();
