# Resultados do teste de carga — 19/11/2026

Mock da Google Sheets API com as cotas padrão (por minuto: 300 leituras e 300 gravações por projeto; 60 por usuário).
Cenário: todos os usuários abrem o app em 2 minutos (início de turno) e usam por 8 minutos.

| Cenário | Abrir o app (95%) | Recusas por cota (429) | Erro que chega ao usuário |
|---|---|---|---|
| 100 usuários · versão atual (6 leituras ao abrir) | 3,6 s | 2,7% (todas recuperadas na nova tentativa) | 0% |
| 100 usuários · otimizada (2 leituras ao abrir) | 0,8 s | 0% | 0% |
| 1000 usuários · versão atual | 53 s | 86,5% | 59% |
| 1000 usuários · otimizada | 18 s | 71,8% | 32,6% |

Conclusão: com a cota padrão, o limite é a cota do projeto (300/min), não o app. A versão otimizada aguenta folgado
100 usuários; para 1000 ao mesmo tempo é preciso aumentar a cota do projeto no Google Cloud (leitura e gravação).
Pela conta, a otimizada usa ~0,3 leitura e ~0,3 gravação por minuto por usuário em uso, mais 2 leituras ao abrir.
