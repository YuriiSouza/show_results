// Configuração do dashboard.
// O link da planilha e a chave de acesso são definidos na engrenagem (⚙) do aplicativo
// e ficam salvos apenas no computador.
window.APP_CONFIG = {
  HUB_NAME: 'HUB LGO 03',
  HUB_CITY: 'Anápolis',

  // E-mail da conta de serviço embutida: toda planilha conectada precisa ser
  // compartilhada com ele (como Leitor).
  SERVICE_ACCOUNT_EMAIL: 'sheets-convocation@shopee-convocation-control.iam.gserviceaccount.com',

  // Atualização automática padrão (minutos). 0 = desligada.
  AUTO_REFRESH_MIN: 5,
  // Tempo de cada aba no Modo TV (segundos).
  TV_ROTATE_SEC: 30,

  // Planilha-base compartilhada: onde o app grava os reports preenchidos e os relatórios Audit
  // importados, para todos os usuários verem. Compartilhe com o e-mail acima como EDITOR.
  BASE_SHEET_URL: 'https://docs.google.com/spreadsheets/d/10e4zgv7kzpx8L4Gbx1TJUgmnBr3-ccSm_ty_JXvByIU/edit',

  // Nome das guias da planilha. Ajuste se renomear alguma.
  SHEETS: {
    recebimento: 'Recebimento',
    hc: 'HC',
    phd: 'PHD',
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

  // Metas usadas para colorir indicadores (✓ / ⚠). Ajuste conforme a operação.
  METAS: {
    absMax: 0.05,       // % ABS máximo
    dsMin: 0.98,        // DS mínimo
    dsD0Min: 0.95,      // DS D0 mínimo
    aderenciaMin: 0.90, // Vol real / Vol projetado mínimo
    missingMax: 0.005,  // % de pedidos missing máximo
    tempoConferenciaMin: 6, // tempo máximo de conferência por AT, em minutos (00:06:00)
  },
};
