// Ícone "?" pequeno ao lado de um número: clicando, mostra o que ele significa. Funciona com mouse e toque.
// Uso: Help.tip('naoBipados') dentro do HTML (rótulo de KPI, cabeçalho de tabela, título de card).
window.Help = (() => {
  const TEXTS = {
    naoBipados: {
      t: 'Não bipados na conferência',
      d: 'Pacotes da rota que <b>não foram bipados</b> na conferência (no relatório: <i>Missing Orders</i>). Ex.: um pacote da rota A-1 que não foi bipado. Pode ser que o pacote estivesse ali e o conferente não bipou, ou que ele nem estivesse fisicamente na rota.',
    },
    outraRota: {
      t: 'Pacotes de outra rota',
      d: 'Pacotes <b>bipados na conferência de uma rota, mas que são de outra rota</b> (no relatório: <i>Missorted Orders</i>). Ex.: na conferência da rota A-1 foi bipado um pacote da A-2. Não dá para saber se foi erro de etiquetagem ou de separação — só que o pacote não deveria estar ali.',
    },
    noshow: {
      t: 'Rotas noshow',
      d: 'Rotas que aparecem no relatório com AT, mas <b>sem nenhum pacote escaneado</b> (coluna E "Total Scanned Orders" vazia ou 0) — a rota não foi conferida. Conta para o Report geral do dia.',
    },
    pctNaoBipados: {
      t: '% não bipados',
      d: 'Pacotes não bipados na conferência divididos pelo total de pedidos das rotas (inicial). É o número comparado com a meta.',
    },
    atsNaoBipados: {
      t: 'ATs com não bipados',
      d: 'Quantas ATs/rotas tiveram pelo menos um pacote não bipado na conferência.',
    },
  };
  const tip = key => (TEXTS[key] ? `<button type="button" class="help-tip" data-help="${key}" aria-label="O que é: ${TEXTS[key].t}" title="O que é isso?">?</button>` : '');

  let pop = null;
  const close = () => { if (pop) { pop.remove(); pop = null; } };
  function open(btn) {
    close();
    const x = TEXTS[btn.dataset.help];
    if (!x) return;
    pop = document.createElement('div');
    pop.className = 'help-pop';
    pop.setAttribute('role', 'dialog');
    pop.innerHTML = `<b>${x.t}</b><div>${x.d}</div>`;
    document.body.appendChild(pop);
    const r = btn.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const top = r.bottom + 8 + h > window.innerHeight ? r.top - h - 8 : r.bottom + 8;
    pop.style.left = `${left}px`;
    pop.style.top = `${Math.max(8, top)}px`;
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('.help-tip');
    if (b) { e.preventDefault(); e.stopPropagation(); if (pop && pop.dataset.for === b.dataset.help) close(); else { open(b); if (pop) pop.dataset.for = b.dataset.help; } return; }
    if (pop && !e.target.closest('.help-pop')) close();
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  window.addEventListener('scroll', close, true);
  window.addEventListener('resize', close);
  return { tip, TEXTS };
})();
