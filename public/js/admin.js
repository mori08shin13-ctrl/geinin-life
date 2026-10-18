// ===============================================================
//  管理画面：ご意見・ご要望を読む（管理者パスワードが必要）
//  パスワードはこのタブを閉じると消える sessionStorage にだけ置く
// ===============================================================
const KEY = 'geinin-admin';
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const getPass = () => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } };
const setPass = (v) => { try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY); } catch {} };

async function call(method = 'GET', id) {
  const res = await fetch(`/api/admin/feedback${id ? `?id=${id}` : ''}`, { method, headers: { authorization: `Bearer ${getPass()}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `エラー ${res.status}`), { status: res.status });
  return body;
}

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

async function load() {
  try {
    const { items } = await call();
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
$('#logout').onclick = () => { setPass(''); $('#items').innerHTML = ''; $('#list').hidden = true; $('#login').hidden = false; $('#login-error').textContent = ''; };
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
