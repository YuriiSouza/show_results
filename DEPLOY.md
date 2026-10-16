# Como publicar uma versão (Windows e Android) no GitHub Releases

O app desktop verifica sozinho, ao abrir, se existe uma Release mais nova em
https://github.com/YuriiSouza/show_results/releases. Se existir, mostra a janela **"Atualização do aplicativo"**:
**Atualizar agora** baixa (com barra de progresso) e **Reiniciar e instalar** aplica. Se a pessoa deixar para depois,
a versão baixada é instalada ao fechar o app.

No Android o app consulta a mesma Release e, se houver um `.apk` mais novo, oferece **Baixar**.

---

## Parte 1 — Configuração (uma vez só)

### 1.1 Google Cloud
- Tela de consentimento **Interna** (Google Workspace), Google Sheets API ativada,
  escopo `https://www.googleapis.com/auth/spreadsheets`.
- Client OAuth **App para computador** (desktop) e client **Android** (pacote `br.hub.lgo03.dashboard`, com o SHA-1 da
  chave de assinatura; em "Configurações avançadas", ative o **esquema de URI personalizado**).
- Crie `google-oauth.local.json` na raiz do projeto (modelo em `google-oauth.example.json`). Ele está no `.gitignore`:
  **nunca** comite o client secret (`GOCSPX-...`) — o GitHub bloqueia o push.

### 1.2 GitHub
- **Settings → Secrets and variables → Actions → New repository secret**:
  `GOOGLE_OAUTH_JSON` = o conteúdo inteiro do `google-oauth.local.json`.
- **Settings → Actions → General → Workflow permissions**: marque **Read and write permissions**
  (o workflow cria a Release e envia os instaladores).

### 1.3 Planilhas
Compartilhe as planilhas mensais (Leitor) e a planilha-base (**Editor**) com as contas de quem usa o app.

### 1.4 Android: chave de assinatura
No Android Studio: **Build → Generate Signed App Bundle / APK → APK → Create new…**. Guarde o `.jks` fora do projeto:
as próximas versões precisam ser assinadas com ele, senão o Android não instala a atualização por cima.
Cadastre o SHA-1 dessa chave no client OAuth Android.

---

## Parte 2 — A cada nova versão

### 2.1 Aumentar a versão e criar a tag
```bash
npm version patch
```
(1.3.0 → 1.3.1; use `minor` para novidades maiores). Isso atualiza o `package.json`, faz o commit e cria a tag `v1.3.1`.

```bash
git push --follow-tags
```

### 2.2 Windows (automático)
O push da tag `v*` dispara o workflow **Release desktop (Windows)** (`.github/workflows/release-desktop.yml`), que gera
e publica na Release:
- `Dashboard-HUB-LGO03-<versão>-Windows-Instalador.exe` (+ `.blockmap`)
- `Dashboard-HUB-LGO03-<versão>-Windows-Portatil.exe`
- `latest.yml` (é o que a atualização automática lê)

A tag precisa bater com a versão do `package.json`, senão o workflow falha. Também dá para rodar manualmente em
**Actions → Release desktop → Run workflow**.

Para gerar localmente (sem publicar): `npm run dist:win` (saem em `dist/`).

### 2.3 Android (manual)
```bash
npm run mobile:android
```
No Android Studio: **Build → Generate Signed App Bundle / APK → APK**, chave `.jks` do passo 1.4, variante **release**.
Renomeie `android/app/release/app-release.apk` para `Dashboard-HUB-LGO03-<versão>-Android.apk` e anexe na Release
da mesma versão (**Releases → Edit → Attach binaries**).

Linha de comando (Capacitor 8 precisa do **JDK 21**; o JDK 25 embutido no Android Studio novo e o 17 não servem):
```bash
JAVA_HOME=~/.jdks/jbr-21.0.11 ./android/gradlew -p android assembleRelease
```

---

## Parte 3 — Instalar

### Windows
1. Baixe o **Instalador** na página de Releases e execute. Se aparecer **"O Windows protegeu o computador"**
   (o app não tem assinatura digital paga): **Mais informações → Executar assim mesmo**.
2. Sem permissão de administrador? Use o **Portatil.exe** (ele avisa das versões novas, mas a atualização é baixar o novo `.exe`).
3. As próximas versões chegam pela janela de atualização do próprio app.

### Android
1. Baixe o `.apk` na página de Releases e toque nele. Permita **"Instalar apps desconhecidos"** quando o Android pedir.
2. **Atualizar:** quando o app avisar, toque em **Baixar** e instale por cima (os dados continuam, desde que o APK seja
   assinado com a mesma chave `.jks`).

### Primeiro uso (qualquer aparelho)
1. Abra o app → **Conectar planilhas** (rodapé do menu) → **Entrar com Google**.
2. Confira os links das planilhas de cada mês → **Testar** → **Salvar e atualizar**.
3. Na primeira vez que salvar um report ou importar um Audit, o app pede o **seu nome**.
