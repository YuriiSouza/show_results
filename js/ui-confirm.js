// Confirmação dentro do app (no lugar do confirm() do sistema). No Electron, depois de um confirm()/alert() nativo
// os campos de texto param de aceitar digitação até a janela perder e ganhar o foco — por isso o app não usa.
window.uiConfirm = (message, { ok = 'Confirmar', cancel = 'Cancelar' } = {}) => new Promise(resolve => {
  const active = document.activeElement;
  const dlg = document.createElement('dialog');
  dlg.className = 'ui-confirm';
  dlg.innerHTML = '<div class="settings"><p class="ui-confirm-msg"></p><div class="ui-confirm-actions">' +
    '<button type="button" class="btn-ghost" data-v="0"></button><button type="button" class="btn-primary solid" data-v="1"></button></div></div>';
  dlg.querySelector('.ui-confirm-msg').textContent = message;
  dlg.querySelector('[data-v="0"]').textContent = cancel;
  dlg.querySelector('[data-v="1"]').textContent = ok;
  document.body.appendChild(dlg);
  const done = v => {
    dlg.close(); dlg.remove(); resolve(v);
    // Devolve o foco para onde estava (ex.: o campo do código), se ele ainda existir.
    if (active && document.contains(active) && active.focus) setTimeout(() => active.focus(), 0);
  };
  dlg.addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) done(b.dataset.v === '1'); });
  dlg.addEventListener('cancel', e => { e.preventDefault(); done(false); });
  dlg.showModal();
  dlg.querySelector('[data-v="1"]').focus();
});
