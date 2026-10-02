// Lógica pura da aba "Parcel" (sem tela e sem rede): leitura do relatório de contagem e extração de
// chegada / missing / AT / motorista a partir do JSON de rastreio do SPX.
// Roda no app (window.ParcelCore) e no Node (testes em test/).
const ParcelCore = (() => {
  const DEFAULTS = { stationName: 'LM Hub_GO_Anápolis', stationId: 9657, driverWindowSec: 30 * 60 };
  const CODE_RE = /^[A-Z0-9]{8,40}$/;
  const AT_RE = /Assignment Task \[(AT\w+)\]/;
  const DRIVER_RE = /Motorista:\s*\[(\d+)\]\s*([^;]+)/;
  // Evento de AT: pelo status ou pelo texto "em processamento na / adicionado à Assignment Task [AT...]".
  const AT_TEXT_RE = /(processamento|adicionad[oa])\b.*Assignment Task \[/i;
  // Gaiola: uma letra, traço e número (ex.: A-13).
  const CAGE_RE = /(?<![\w-])([A-Z]-\d{1,3})(?![\w-])/;
  const CAGE_ONLY_RE = /^[A-Z]-\d{1,3}$/;
  // Gaiola de um objeto (sem descer nos filhos): campo com nome de gaiola (cage/gaiola/corridor),
  // qualquer campo cujo valor inteiro seja uma gaiola, ou o texto da mensagem.
  function cageIn(obj) {
    if (!obj || typeof obj !== 'object') return '';
    const entries = Object.entries(obj).filter(([, v]) => typeof v === 'string');
    const named = entries.find(([k, v]) => /cage|gaiola|corridor/i.test(k) && CAGE_RE.test(v));
    if (named) return named[1].match(CAGE_RE)[1];
    const whole = entries.find(([, v]) => CAGE_ONLY_RE.test(v.trim()));
    if (whole) return whole[1].trim();
    const m = String(obj.message || '').match(CAGE_RE);
    return m ? m[1] : '';
  }
  // Gaiola fora dos eventos (dados gerais do pedido), em qualquer nível da resposta.
  function cageTop(resp) {
    const walk = (x, depth) => {
      if (!x || typeof x !== 'object' || depth > 6) return '';
      if (!Array.isArray(x)) { const c = cageIn({ ...x, message: '' }); if (c) return c; }
      for (const [k, v] of Object.entries(x)) {
        if (k === 'tracking_list' || k === 'children' || k === 'event_children') continue;
        const c = walk(v, depth + 1);
        if (c) return c;
      }
      return '';
    };
    return walk(resp, 0);
  }
  // AT: nas respostas reais os eventos vêm com status 49 (em processamento) e 50 (adicionado); 417/418 são aceitos também.
  const ST = { delivering: 2, at: [49, 50, 417, 418], transfer: 420, missing: 581 };

  // Texto delimitado (TSV/CSV) -> matriz de textos. O separador é detectado na 1ª linha e
  // nenhuma célula vira número (os códigos de rastreio ficam exatamente como estão no arquivo).
  function parseTable(text) {
    text = String(text || '').replace(/^﻿/, '');
    const nl = text.search(/\r|\n/);
    const first = nl >= 0 ? text.slice(0, nl) : text;
    const count = ch => first.split(ch).length - 1;
    const sep = ['\t', ';', ','].reduce((a, b) => (count(b) > count(a) ? b : a));
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"' && cell === '') q = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.map(r => r.map(c => c.trim())).filter(r => r.some(Boolean));
  }

  // tracking_list + children + event_children, achatados e em ordem de horário.
  function flatten(resp) {
    const root = (resp && (resp.tracking_list || (resp.data && resp.data.tracking_list))) || [];
    const out = [], seen = new Set();
    const walk = list => (Array.isArray(list) ? list : []).forEach(ev => {
      if (!ev || typeof ev !== 'object') return;
      let ts = Number(ev.timestamp);
      if (ts > 1e12) ts = Math.floor(ts / 1000);
      if (isFinite(ts) && ts > 0) {
        const key = [ts, ev.status, ev.message, ev.operator].join('|');
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ ts, status: Number(ev.status), message: String(ev.message || ''), operator: String(ev.operator || '').trim(),
            station: String(ev.station_name || '').trim(), stationId: Number(ev.station_id) || null, cage: cageIn(ev) });
        }
      }
      walk(ev.children); walk(ev.event_children);
    });
    walk(root);
    return out.sort((a, b) => a.ts - b.ts);
  }

  // Regras por código:
  // - chegada: 1º evento na estação do hub;
  // - missing: 1º evento a partir da chegada com status 581 ou "marked as missing";
  // - AT anterior: última AT antes do missing (ATs depois do missing não entram);
  // - gaiola e motorista: vêm do detalhe da AT (outra requisição; ver rowOf). Sem o detalhe, o motorista é o do
  //   evento seguinte de status 2 ("Motorista:[ID] NOME"), até 30 min depois — vínculo por proximidade de horário.
  function extract(resp, opts) {
    const o = { ...DEFAULTS, ...(opts || {}) };
    const ev = flatten(resp);
    const info = { events: ev.length, arrival: null, missing: null, atBefore: null, cageTop: cageTop(resp), notes: [] };
    if (!ev.length) { info.notes.push('Rastreio sem eventos'); return info; }

    const arrival = ev.find(e => e.station === o.stationName || e.stationId === o.stationId);
    if (!arrival) { info.notes.push(`Sem passagem pelo ${o.stationName}`); return info; }
    info.arrival = { ts: arrival.ts, status: arrival.status, message: arrival.message };

    const missing = ev.find(e => e.ts >= arrival.ts && (e.status === ST.missing || /marked as missing/i.test(e.message)));
    if (!missing) { info.notes.push('Sem missing após a chegada'); return info; }
    info.missing = { ts: missing.ts, status: missing.status, operator: missing.operator };

    const ats = ev.filter(e => AT_RE.test(e.message) && (ST.at.includes(e.status) || AT_TEXT_RE.test(e.message)))
      .map(e => ({ ...e, code: e.message.match(AT_RE)[1] }));
    const describe = at => {
      const same = ats.filter(x => x.code === at.code);
      const from = same[0].ts, last = same[same.length - 1].ts;
      const next = ats.find(x => x.code !== at.code && x.ts > last);
      const d = ev.find(e => e.status === ST.delivering && e.ts >= from && e.ts <= last + o.driverWindowSec && DRIVER_RE.test(e.message));
      const m = d && d.message.match(DRIVER_RE);
      // Transferência (status 420): a mensagem traz o ID em notação científica; o ID certo está em operator "[ID]NOME".
      const transfers = !d ? [] : ev.filter(e => e.status === ST.transfer && e.ts >= d.ts && (!next || e.ts < next.ts))
        .map(e => { const t = e.operator.match(/^\[(\d+)\]\s*(.*)$/); return t ? { id: t[1], name: t[2].trim(), ts: e.ts } : null; })
        .filter(Boolean);
      // Gaiola: nos eventos da própria AT; senão, nos eventos seguintes até a próxima AT (ou até o fim da janela do motorista).
      const until = next ? next.ts : last + o.driverWindowSec;
      const cage = (same.find(x => x.cage) || ev.find(e => e.cage && e.ts >= from && e.ts < until) || {}).cage || '';
      return { code: at.code, ts: from, station: same[0].station, cage,
        driver: m ? { id: m[1], name: m[2].trim(), ts: d.ts } : null, transfers };
    };
    const before = ats.filter(x => x.ts < missing.ts).pop();
    if (before) info.atBefore = describe(before); else info.notes.push('Sem AT antes do missing');
    return info;
  }

  // Uma linha da tabela de resultado. atDetail = resposta do detalhe da AT anterior (assignment_task/detail):
  // traz a gaiola (corridor_cage) e o motorista (driver_id / driver_name) da AT, sem precisar inferir.
  function rowOf(code, info, atDetail, atError) {
    const at = info.atBefore;
    const notes = info.notes.slice();
    let cage = '', driverId = '', driverName = '';
    if (at && atDetail) {
      cage = String(atDetail.corridor_cage || '').trim();
      driverId = atDetail.driver_id ? String(atDetail.driver_id) : '';
      driverName = String(atDetail.driver_name || '').trim();
      if (!cage) notes.push('AT sem gaiola');
      if (!driverId && !driverName) notes.push('AT sem motorista atribuído');
    } else if (at) {
      if (atError) notes.push('Detalhe da AT indisponível: ' + atError);
      cage = at.cage || info.cageTop || '';
      if (at.driver) { driverId = at.driver.id; driverName = at.driver.name; notes.push('Motorista vinculado à AT por proximidade de horário'); }
      else if (!atError) notes.push('Motorista da AT não encontrado');
      if (at.transfers.length) notes.push('Transferido para ' + at.transfers.map(t => `[${t.id}] ${t.name}`).join(' → '));
    }
    return {
      code,
      missingOperator: info.missing ? info.missing.operator : '',
      atBefore: at ? at.code : '', cage, driverId, driverName,
      note: notes.join('; '),
    };
  }

  return { DEFAULTS, CODE_RE, parseTable, flatten, extract, rowOf };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ParcelCore;
else window.ParcelCore = ParcelCore;
