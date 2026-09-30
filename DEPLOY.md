# Como publicar uma versão (Windows e Android) no Google Drive

Toda vez que é aberto, o app verifica se existe na pasta do Drive (fixa no app) um instalador com
**versão maior** que a dele. Se existir, aparece no topo: **"🚀 Nova versão X disponível — Baixar"**.
O usuário clica em Baixar, o Drive abre o arquivo e ele instala por cima.

A versão é lida do **nome do arquivo**, então os nomes precisam seguir este padrão:

| Sistema | Nome do arquivo |
|---|---|
| Windows (instalador) | `Dashboard-HUB-LGO03-1.0.1-Windows-Instalador.exe` |
| Windows (portátil) | `Dashboard-HUB-LGO03-1.0.1-Windows-Portatil.exe` |
| Android | `Dashboard-HUB-LGO03-1.0.1-Android.apk` |

---

## Parte 1 — Configuração (uma vez só)

### 1.1 Pasta no Drive
A pasta já está fixa no app (`DRIVE_FOLDER_URL` em `js/config.js`):
https://drive.google.com/drive/folders/1enqpqllLcUkMDKoxi2QqoKmHhpFtJfaj

Em **Compartilhar** dessa pasta:
- adicione o e-mail do app como **Leitor** (desmarque "Notificar pessoas"):
  `sheets-convocation@shopee-convocation-control.iam.gserviceaccount.com`
- adicione as pessoas da equipe (ou o grupo da equipe) como **Leitor**, para elas conseguirem baixar.
- **Não** deixe como "Qualquer pessoa com o link": o instalador leva a chave de acesso dentro dele.

### 1.2 Ativar a Google Drive API
1. Acesse https://console.cloud.google.com/apis/library/drive.googleapis.com
2. Confira no topo se o projeto selecionado é **shopee-convocation-control**.
3. Clique em **Ativar**.

### 1.3 Chave de acesso no projeto
```bash
cp ~/Downloads/shopee-convocation-control-9b7517cdb3e2.json /Users/yurisouza/dev/show/electron/credentials/service-account.json
```

### 1.4 Android: instalar o Android Studio e criar a chave de assinatura
1. Instale o [Android Studio](https://developer.android.com/studio) (traz o Java e o Android SDK).
2. Abra o projeto Android uma vez para ele baixar o que falta:
   ```bash
   cd /Users/yurisouza/dev/show && npm run mobile:android
   ```
3. Crie a **chave de assinatura** (feito uma única vez): no Android Studio,
   **Build → Generate Signed App Bundle / APK → APK → Next → Create new…**
   - Salve o arquivo `.jks` num lugar seguro **fora do projeto** e anote as senhas.
   - **Guarde bem essa chave:** as próximas versões precisam ser assinadas com ela,
     senão o Android não deixa instalar a atualização por cima.

---

## Parte 2 — A cada nova versão

### 2.1 Aumentar o número da versão
Na pasta do projeto, escolha um:
```bash
npm version patch --no-git-tag-version
```
(1.0.0 → 1.0.1: correções). Para novidades maiores use `minor` (1.0.1 → 1.1.0).

A versão é copiada automaticamente para o app, o Android e os nomes dos instaladores.

### 2.2 Gerar o Windows
```bash
cd /Users/yurisouza/dev/show && npm run dist:win
```
Saem em `dist/`:
- `Dashboard-HUB-LGO03-1.0.1-Windows-Instalador.exe`
- `Dashboard-HUB-LGO03-1.0.1-Windows-Portatil.exe`

### 2.3 Gerar o Android
```bash
cd /Users/yurisouza/dev/show && npm run mobile:android
```
No Android Studio: **Build → Generate Signed App Bundle / APK → APK → Next**, escolha a chave `.jks`
criada no passo 1.4, variante **release** → **Create**.
O arquivo sai em `android/app/release/app-release.apk`. **Renomeie** para:
`Dashboard-HUB-LGO03-1.0.1-Android.apk`

### 2.4 Subir no Drive
Arraste para a pasta do Drive:
- `Dashboard-HUB-LGO03-1.0.1-Windows-Instalador.exe`
- `Dashboard-HUB-LGO03-1.0.1-Windows-Portatil.exe` (opcional)
- `Dashboard-HUB-LGO03-1.0.1-Android.apk`

Pronto: da próxima vez que cada pessoa abrir o app, aparece o aviso.
Pode deixar as versões antigas na pasta; o app sempre escolhe a maior.

---

## Parte 3 — Instalar em qualquer computador ou celular

### Windows
1. Abra a pasta do Drive e baixe o **Instalador**.
2. Execute. Se aparecer **"O Windows protegeu o computador"** (o app não tem assinatura digital paga):
   **Mais informações → Executar assim mesmo**.
3. Escolha a pasta e conclua. O atalho fica no menu Iniciar.
   - Sem permissão de administrador? Use o **Portatil.exe**: é só abrir, não instala nada.
4. **Atualizar:** quando aparecer o aviso, clique em **Baixar**, feche o app e rode o novo instalador
   por cima. Configuração, nome de usuário e rascunhos continuam.

### Android
1. No celular, abra a pasta do Drive (app do Google Drive, logado com a conta que tem acesso) e toque no `.apk`.
2. O Android pede para permitir **"Instalar apps desconhecidos"** para o Drive: **Configurações → Permitir**.
3. Toque em **Instalar**. Se o Play Protect avisar, **Instalar mesmo assim**.
4. **Atualizar:** quando aparecer o aviso, toque em **Baixar** e instale por cima (os dados continuam,
   desde que o APK seja assinado com a mesma chave `.jks`).

### Primeiro uso (qualquer aparelho)
1. Abra o app → **Conectar planilhas** (rodapé do menu).
2. Cole o link da planilha de cada mês → **Testar** → **Salvar e atualizar**.
3. Na primeira vez que salvar um report ou importar um Audit, o app pede o **seu nome**.

---

## Resumo do que precisa estar compartilhado com `sheets-convocation@shopee-convocation-control.iam.gserviceaccount.com`

| O quê | Permissão |
|---|---|
| Planilhas mensais | Leitor |
| Planilha-base (reports e Audit) | **Editor** |
| Pasta do Drive com os instaladores | Leitor |

APIs ativadas no projeto `shopee-convocation-control`: **Google Sheets API** e **Google Drive API**.
