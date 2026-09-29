// Camada fina sobre o Chart.js: cores do tema, formatação pt-BR e tabela alternativa.
window.Charts = (() => {
  const registry = new Map();
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  const fmt = {
    int: v => v == null ? '—' : Math.round(v).toLocaleString('pt-BR'),
    dec: (v, d = 1) => v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }),
    pct: (v, d = 1) => v == null ? '—' : (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%',
    compact: v => v == null ? '' : Math.abs(v) >= 1000 ? (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k' : Math.round(v).toLocaleString('pt-BR'),
  };

  // Rótulo de total acima de barras empilhadas (só quando há espaço).
  const stackTotals = {
    id: 'stackTotals',
    afterDatasetsDraw(chart, _args, opts) {
      if (!opts || !opts.enabled) return;
      const { ctx } = chart;
      const metas = chart.data.datasets.map((d, i) => chart.getDatasetMeta(i))
        .filter(m => m.type === 'bar' && !m.hidden);
      if (!metas.length) return;
      const n = chart.data.labels.length;
      const barW = metas[0].data[0] ? metas[0].data[0].width : 0;
      if (barW < 16) return;
      ctx.save();
      ctx.font = '600 10px Inter, system-ui, sans-serif';
      ctx.fillStyle = css('--text-2');
      ctx.textAlign = 'center';
      for (let i = 0; i < n; i++) {
        let sum = 0, top = Infinity, x = null, any = false;
        metas.forEach(m => {
          const v = chart.data.datasets[m.index].data[i];
          const el = m.data[i];
          if (v == null || !el) return;
          any = true; sum += v; top = Math.min(top, el.y); x = el.x;
        });
        if (any && sum) ctx.fillText((opts.format || fmt.compact)(sum), x, top - 5);
      }
      ctx.restore();
    },
  };
  Chart.register(stackTotals);

  function applyDefaults() {
    Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
    Chart.defaults.font.size = 12;
    Chart.defaults.color = css('--text-2');
    Chart.defaults.borderColor = css('--grid');
    Chart.defaults.animation.duration = 350;
  }

  const color = i => css(`--s${i}`);
  const seq = i => css(`--q${i}`);

  function bar(label, data, c, extra = {}) {
    return { type: 'bar', label, data, backgroundColor: c, borderColor: css('--surface'), borderWidth: 1,
             borderRadius: 4, borderSkipped: 'start', maxBarThickness: 36, ...extra };
  }
  function line(label, data, c, extra = {}) {
    return { type: 'line', label, data, borderColor: c, backgroundColor: c, borderWidth: 2, pointRadius: 3,
             pointHoverRadius: 5, pointBackgroundColor: c, pointBorderColor: css('--surface'), pointBorderWidth: 1.5,
             tension: 0.25, spanGaps: false, ...extra };
  }
  // Linha de referência (meta / média) tracejada.
  function ref(label, value, n, c = css('--ref')) {
    return { type: 'line', label, data: Array(n).fill(value), borderColor: c, borderWidth: 1.5, borderDash: [6, 4],
             pointRadius: 0, pointHoverRadius: 0, fill: false, stack: 'ref:' + label, order: -1, isRef: true };
  }

  function render(id, { labels, datasets, stacked = false, yFormat = fmt.int, totals = false, horizontal = false,
                        yMin, yMax, legend = datasets.length > 1, tooltipFormat, onClick } = {}) {
    const canvas = document.getElementById(id);
    if (!canvas) return null;
    if (registry.has(id)) registry.get(id).destroy();
    // Nenhum valor lançado no período: mostra um aviso no lugar de eixos vazios.
    // Só zeros também conta como vazio (dias ainda não lançados costumam vir como 0 pelas fórmulas).
    const hasData = datasets.some(d => !d.isRef && (d.data || []).some(v => v != null && v !== 0 && !(typeof v === 'number' && isNaN(v))));
    const box = canvas.parentElement;
    const old = box.querySelector('.chart-empty');
    if (old) old.remove();
    canvas.style.display = hasData ? '' : 'none';
    if (!hasData) {
      box.insertAdjacentHTML('beforeend', '<div class="chart-empty">Sem valores lançados neste período</div>');
      return null;
    }
    const tf = tooltipFormat || yFormat;
    const valueAxis = {
      stacked, beginAtZero: yMin == null, min: yMin, max: yMax,
      grid: { color: css('--grid'), drawTicks: false }, border: { display: false },
      ticks: { callback: v => yFormat(v), padding: 8, maxTicksLimit: 6 },
    };
    const catAxis = { stacked, grid: { display: false }, border: { color: css('--border') },
                      ticks: { autoSkip: true, maxRotation: 0, autoSkipPadding: 8 } };
    const chart = new Chart(canvas, {
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: horizontal ? 'y' : 'x',
        interaction: { mode: 'index', intersect: false, axis: horizontal ? 'y' : 'x' },
        layout: { padding: { top: totals ? 16 : 4 } },
        scales: horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
        plugins: {
          legend: { display: legend, position: 'top', align: 'start',
                    labels: { usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, boxHeight: 10, padding: 14,
                              sort: (a, b) => a.datasetIndex - b.datasetIndex } },
          tooltip: {
            backgroundColor: css('--surface'), titleColor: css('--text'), bodyColor: css('--text-2'),
            borderColor: css('--border'), borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true,
            filter: item => item.raw != null && !item.dataset.isRef,
            callbacks: {
              label: c => ` ${c.dataset.label}: ${tf(c.raw)}`,
              footer: items => {
                if (!stacked) return '';
                const bars = items.filter(i => i.dataset.type === 'bar' && i.raw != null);
                if (bars.length < 2) return '';
                return 'Total: ' + tf(bars.reduce((s, i) => s + i.raw, 0));
              },
            },
          },
          stackTotals: { enabled: totals, format: fmt.compact },
        },
        onClick,
      },
    });
    chart.$yFormat = tf;
    registry.set(id, chart);
    return chart;
  }

  // Tabela gerada a partir dos dados do gráfico (alternativa acessível).
  function tableFor(id) {
    const chart = registry.get(id);
    if (!chart) return '';
    const ds = chart.data.datasets.filter(d => !d.isRef);
    const f = chart.$yFormat || fmt.int;
    const head = `<tr><th></th>${ds.map(d => `<th>${esc(d.label)}</th>`).join('')}</tr>`;
    const rows = chart.data.labels.map((l, i) =>
      `<tr><td>${esc(l)}</td>${ds.map(d => `<td>${d.data[i] == null ? '—' : f(d.data[i])}</td>`).join('')}</tr>`).join('');
    return `<table><thead>${head}</thead><tbody>${rows}</tbody></table>`;
  }

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function destroyAll() { registry.forEach(c => c.destroy()); registry.clear(); }

  return { fmt, applyDefaults, color, seq, css, bar, line, ref, render, tableFor, destroyAll, esc };
})();
