// Leitura das guias da planilha (matriz de textos exibidos, como o Sheets mostra).
// Não depende de posição fixa: procura as linhas "DIA" e os rótulos pelo texto.
window.Parser = (() => {
  const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

  const txt = v => (v == null ? '' : String(v)).trim();

  // Normaliza rótulos: sem acento, sem emoji, minúsculo. "🚛 PHD:" -> "phd"
  const norm = v => txt(v)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%+/]+/g, ' ')
    .trim();

  // Converte "4.807", "4,76%", "99.52%", "104.3", "#DIV/0!" etc.
  // Percentuais viram fração (4,76% -> 0.0476). Vazio/erro -> null.
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = txt(v);
    if (!s || s.startsWith('#')) return null;
    const pct = s.endsWith('%');
    s = s.replace(/[%\s]|R\$/g, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    if (!/^-?\d*\.?\d+$/.test(s)) return null;
    const n = parseFloat(s);
    return pct ? n / 100 : n;
  }

  const isDate = v => DATE_RE.test(txt(v));
  const rowEmpty = row => !row || row.every(c => !txt(c));

  // Encontra os blocos "título / DIA / linhas de métricas" de uma guia.
  function parseBlocks(grid) {
    const blocks = [];
    let cur = null;
    (grid || []).forEach((row, r) => {
      row = row || [];
      const hasDia = row.some(c => /^dias?$/.test(norm(c)));
      const dateCols = [];
      row.forEach((c, i) => { if (isDate(c)) dateCols.push([i, txt(c)]); });

      if (hasDia && dateCols.length >= 5) {
        let title = '';
        for (let k = r - 1; k >= Math.max(0, r - 2); k--) {
          const prev = grid[k] || [];
          const first = prev.map(txt).find(Boolean);
          if (first) { if (!prev.some(c => num(c) !== null)) title = first; break; }
        }
        cur = { title, key: norm(title), firstDateCol: dateCols[0][0], dateCols,
                dates: dateCols.map(d => d[1]), series: new Map(), section: '' };
        blocks.push(cur);
        return;
      }
      if (!cur) return;
      if (rowEmpty(row)) { if (cur.series.size) cur = null; return; }

      // Rótulo = célula preenchida mais próxima à esquerda das datas;
      // uma célula mais à esquerda ainda é a seção (ex.: Gerencial "PERFOMANCE | Volume").
      let label = '', section = '';
      for (let c = cur.firstDateCol - 1; c >= 0; c--) {
        const t = txt(row[c]);
        if (!t) continue;
        if (!label) label = t; else { section = t; break; }
      }
      if (!label) return;
      if (section) cur.section = section;
      const key = norm(label);
      if (cur.series.has(key)) return;
      const values = {};
      cur.dateCols.forEach(([c, d]) => { values[d] = row[c]; });
      cur.series.set(key, { label, section: cur.section, values });
    });
    return blocks;
  }

  // Série alinhada às datas pedidas. blockTitle opcional desambigua rótulos repetidos.
  function series(blocks, label, blockTitle, dates) {
    const lk = norm(label);
    let cands = blocks;
    if (blockTitle != null) {
      const bk = norm(blockTitle);
      const exact = blocks.filter(b => b.key === bk);
      cands = exact.length ? exact : blocks.filter(b => b.key.startsWith(bk));
    }
    for (const b of cands) {
      const s = b.series.get(lk);
      if (s) return dates.map(d => num(s.values[d]));
    }
    return null;
  }

  // ---- Busca livre por rótulo (Report T3, PHD, HC...) ----
  function finder(grid) {
    grid = grid || [];
    const cell = (r, c) => txt((grid[r] || [])[c]);

    function find(label, o = {}) {
      const lk = norm(label);
      const { minCol = 0, maxCol = Infinity, minRow = 0, maxRow = Infinity, exact = false } = o;
      let loose = null;
      for (let r = minRow; r < Math.min(grid.length, maxRow + 1); r++) {
        const row = grid[r] || [];
        for (let c = minCol; c < Math.min(row.length, maxCol + 1); c++) {
          const k = norm(row[c]);
          if (!k) continue;
          if (k === lk) return { r, c };
          if (!exact && !loose && k.startsWith(lk)) loose = { r, c };
        }
      }
      return loose;
    }
    const looksValue = t => t && (/\d/.test(t) && !/[a-z]{4,}/i.test(norm(t)));
    function right(pos, max = 4, any = false) {
      if (!pos) return '';
      for (let c = pos.c + 1; c <= pos.c + max; c++) {
        const t = cell(pos.r, c);
        if (t) return any || looksValue(t) ? t : '';
      }
      return '';
    }
    function below(pos, rows = 1, cols = 3) {
      if (!pos) return '';
      for (let r = pos.r + 1; r <= pos.r + rows; r++)
        for (let c = pos.c; c <= pos.c + cols; c++) { const t = cell(r, c); if (t) return t; }
      return '';
    }
    // Valor à direita; se não houver, logo abaixo.
    const value = (label, o) => { const p = find(label, o); return right(p) || (p ? below(p) : ''); };
    return { grid, cell, find, right, below, value };
  }

  // Tabela com cabeçalho (Missing T1/T3).
  function table(grid, headerMatch) {
    grid = grid || [];
    const hk = norm(headerMatch);
    const h = grid.findIndex(row => (row || []).some(c => norm(c) === hk));
    if (h < 0) return [];
    const headers = grid[h].map(txt);
    return grid.slice(h + 1).filter(row => row && txt(row[0])).map(row => {
      const o = {};
      headers.forEach((name, i) => { if (name) o[name] = txt(row[i]); });
      return o;
    });
  }

  // CSV (vírgula ou ponto e vírgula, aspas, quebras de linha CRLF) -> matriz de textos.
  function csv(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    const firstLine = text.slice(0, text.indexOf('\n') >= 0 ? text.indexOf('\n') : text.length);
    const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => txt(c)));
  }

  const titleCase = s => String(s).toLowerCase().replace(/\s+/g, ' ').trim()
    .replace(/(^|\s)(\p{L})/gu, (m, sp, ch) => sp + ch.toUpperCase())
    .replace(/\b(Da|De|Do|Das|Dos|E)\b/g, w => w.toLowerCase());

  const toDate = s => { const d = new Date(String(s || '').trim().replace(' ', 'T')); return isNaN(d) ? null : d; };

  // Linhas do relatório de validação de AT (LMHub Audit / guias Missing) -> objetos normalizados.
  function auditRows(objs) {
    return objs.map(o => {
      const op = o['Validation Operator'] || '';
      const m = op.match(/^\[(.*?)\]\s*(.*)$/);
      const start = toDate(o['Validation Start Time']);
      const end = toDate(o['Validation End Time']);
      return {
        at: o['AT/TO'], corridor: o['Corridor/Cage'] || '',
        initial: num(o['Total Initial Orders Inside AT/TO']) || 0,
        final: num(o['Total Final Orders Inside AT/TO']) || 0,
        scanned: num(o['Total Scanned Orders']) || 0,
        missorted: num(o['Missorted Orders']) || 0,
        missing: num(o['Missing Orders']) || 0,
        start, end, minutes: start && end ? (end - start) / 60000 : null,
        operator: titleCase(m ? m[2] : op), opsId: m ? m[1] : '',
        revalidator: titleCase((o['Revalidation Operator'] || '').replace(/^\[.*?\]\s*/, '')),
        revalidated: num(o['Revalidated Count']) || 0,
        status: o['AT/TO Validation Status'] || '', remark: o['Remark'] || '',
      };
    });
  }

  return { txt, norm, num, isDate, parseBlocks, series, finder, table, csv, titleCase, toDate, auditRows };
})();
