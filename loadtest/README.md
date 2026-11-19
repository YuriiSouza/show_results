# Teste de carga (k6)

O app não tem servidor próprio: cada aparelho fala direto com o Google Sheets usando a conta de quem está logado. O
gargalo é a **cota da Google Sheets API**, que é do projeto do Google Cloud (somando todos os usuários) e por usuário.
Por isso o teste roda contra um **mock** (`mock-sheets.js`) que imita a API e as cotas, sem tocar no Google de verdade.

1. Mock: `node loadtest/mock-sheets.js` (cotas padrão por minuto: leitura 300 projeto / 60 usuário; escrita 300 / 60;
   ajuste pelas variáveis `COTA_*` com os números do console do Google Cloud).
2. Em outro terminal:
   - `k6 run -e USERS=100 loadtest/app-users.js`
   - `k6 run -e USERS=1000 loadtest/app-users.js`
   - `RETRY=0` simula o app antigo (sem nova tentativa após 429).
3. `curl localhost:8787/_stats` mostra leituras, gravações e recusas (429) por minuto.

Critérios: menos de 1% de chamadas recusadas por cota, 95% abrindo o app em menos de 8 s e menos de 0,5% de erro que
chega ao usuário.
