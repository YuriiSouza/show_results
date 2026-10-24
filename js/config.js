// Configuração do dashboard.
// Os links das planilhas e o login Google ficam na engrenagem (⚙) do aplicativo
// e são salvos apenas no aparelho.
window.APP_CONFIG = {
  HUB_NAME: 'HUB LGO 03',
  HUB_CITY: 'Anápolis',

  // Senha para sair do modo registro (tela cheia dos Erros de piso). Fica no código do app: serve para os
  // colaboradores não saírem da tela por engano, não é uma proteção de segurança.
  KIOSK_PASSWORD: 'admin123',

  // Atualização automática (minutos), fixa para todos os aparelhos. 0 = desligada.
  AUTO_REFRESH_MIN: 30,
  // Tempo de cada aba no Modo TV (segundos).
  TV_ROTATE_SEC: 30,

  // Planilha-base compartilhada: onde o app grava os reports preenchidos e os relatórios Audit
  // importados, para todos os usuários verem. Compartilhe como EDITOR com as contas de quem usa o app.
  BASE_SHEET_URL: 'https://docs.google.com/spreadsheets/d/10e4zgv7kzpx8L4Gbx1TJUgmnBr3-ccSm_ty_JXvByIU/edit',

  // Planilhas mensais padrão (já vêm conectadas em todo aparelho). Chave: 'AAAA-MM'.
  // Um link salvo pelo usuário em "Conectar planilhas" para o mesmo mês tem prioridade.
  // Cada planilha precisa estar compartilhada (como Leitor) com as contas de quem usa o app.
  DEFAULT_MONTHS: {
    '2026-06': 'https://docs.google.com/spreadsheets/d/1NkE0vyBZBztc6BnEppSfGD40nN-JTsQdfMHfPvfsCac/edit',
    '2026-07': 'https://docs.google.com/spreadsheets/d/1bS4L0tZ1UmbFN27RDyCaTRvvfrQsLaqDtdytbf9VzuU/edit',
    '2026-08': 'https://docs.google.com/spreadsheets/d/1lzYnReuKdwJ107eB7F9zNOWtOPZrNBrscuLFrZZCs7k/edit',
    '2026-09': 'https://docs.google.com/spreadsheets/d/1hsO3OzMM8v4xWIO_CRwTRQ0y6EG1ZWzchxR-guFKJQU/edit',
    '2026-10': 'https://docs.google.com/spreadsheets/d/1HZ67FxxF3OBIY45PiCy64lk79Gsh8RmsQ_wI1F0hNQU/edit',
    '2026-11': 'https://docs.google.com/spreadsheets/d/1R5iGLhMuze9sLy6yqtUgFWTnxpTnGcZy-CmCo9xDvjc/edit',
    '2026-12': 'https://docs.google.com/spreadsheets/d/1CnMff3cP7xQQpyxvGcXZrKSrgmm1IwLagi-LDG4s_gg/edit',
  },

  // Nome das guias da planilha. Ajuste se renomear alguma.
  SHEETS: {
    recebimento: 'Recebimento',
    hc: 'HC',
    inventario: 'Inventario',
    reversa: 'Reversa',
    transporte: 'Transporte',
    hse: 'HSE',
    gerencial: 'Gerencial',
    missingT3: 'Missing T3',
    missingT1: 'Missing T1',
  },

  // Reports de turno.
  REPORT: {
    auditShift: { T3: 'AM', T1: 'PM1' }, // turno do relatório Audit que corresponde a cada turno do report
  },

  // Aba Parcel: estação do hub usada para achar a chegada e o missing no rastreio do SPX.
  // hubCode: como o hub aparece no fim do Sort Code (ex.: "SOC-GO2--HUB-LGO-03"). Pacote com outro destino
  // (ex.: "...--XPT-CRX-01") não é do hub.
  // atFromHour: a AT do pacote vale a partir desta hora do dia anterior ao missing (21 = 21:00 da véspera).
  PARCEL: { stationName: 'LM Hub_GO_Anápolis', stationId: 9657, hubCode: 'HUB-LGO-03', atFromHour: 21 },

  // Metas usadas para colorir indicadores (✓ / ⚠). Ajuste conforme a operação.
  METAS: {
    absMax: 0.05,       // % ABS máximo
    dsMin: 0.98,        // DS mínimo
    dsD0Min: 0.95,      // DS D0 mínimo
    aderenciaMin: 0.90, // Vol real / Vol projetado mínimo
    missingMax: 0.005,  // % de pedidos missing máximo
    phd: 457,           // meta de PHD (pacotes ÷ (pessoas + diaristas))
    tempoConferenciaMin: 6, // tempo máximo de conferência por AT, em minutos (00:06:00)
  },
};
