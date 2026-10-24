// Sessão do SPX (cURL colado pelo usuário), usada pelo Parcel, Erros de piso e Recebimento por hora.
// Fica só na memória do app desktop (electron/parcel.js); aqui só abre o diálogo e mostra o estado no cabeçalho.
window.SpxSession = (() => {
  const api = () => window.hubApi || null;
  const available = () => !!(api() && api().parcelSetSession);
  const $ = id => document.getElementById(id);
  let active = false, after = null;
  const listeners = new Set();
  const emit = () => { paint(); listeners.forEach(fn => { try { fn(active); } catch (e) { /* ignora */ } }); };
  const msg = (t, ok) => { $('pcMsg').textContent = t; $('pcMsg').className = 'settings-msg ' + (t ? (ok ? 'ok' : 'err') : ''); };
  function paint() {
    const b = $('btnSpx');
    if (!b) return;
    b.hidden = !available();
    b.classList.toggle('on', active);
    b.title = active ? 'Sessão do SPX ativa (só na memória) · clique para trocar ou esquecer' : 'Sessão do SPX não informada · clique para colar o cURL';
    $('spxDot').className = 'spx-dot' + (active ? ' ok' : '');
  }
  async function has() {
    if (!available()) return false;
    try { active = !!(await api().parcelHasSession()); } catch (e) { active = false; }
    paint();
    return active;
  }
  // Abre o diálogo; onDone roda depois que uma sessão for aceita (ex.: continuar a consulta).
  function open(onDone) {
    if (!available()) return;
    after = onDone || null;
    $('pcCurl').value = '';
    msg(active ? 'Há uma sessão ativa. Cole um cURL novo para trocar.' : '', true);
    $('pcForget').hidden = !active;
    $('parcelDlg').showModal();
  }
  async function clear() {
    if (available()) await api().parcelClearSession();
    active = false; emit();
  }
  function init() {
    paint();
    if (!available()) return;
    $('btnSpx').addEventListener('click', () => open());
    $('pcSaveSession').addEventListener('click', async () => {
      const text = $('pcCurl').value;
      if (!text.trim()) return msg('Cole o cURL copiado do SPX.', false);
      const r = await api().parcelSetSession(text);
      $('pcCurl').value = '';
      if (!r.ok) return msg(r.error, false);
      active = true;
      $('parcelDlg').close();
      emit();
      const fn = after; after = null;
      if (fn) fn();
    });
    $('pcForget').addEventListener('click', async () => { await clear(); $('parcelDlg').close(); });
    has();
  }
  init();
  return { available, has, open, clear, isActive: () => active, onChange: fn => listeners.add(fn) };
})();
