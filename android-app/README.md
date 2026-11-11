# Grefinacia — app Android

App Android do **Grefinacia** (controle financeiro pessoal), gerado a partir do build web
publicado no artifact. É um projeto [Capacitor 8](https://capacitorjs.com): o app React já
compilado fica em `www/index.html` e roda num WebView nativo, com acesso aos plugins abaixo.

| Recurso do app | Plugin nativo |
| --- | --- |
| Lembretes de contas, salário, proventos e metas (canais de notificação) | `@capacitor/local-notifications` |
| Bloqueio por PIN + biometria | `@aparajita/capacitor-biometric-auth` |
| Esconder conteúdo na tela de recentes | `@capacitor/privacy-screen` |
| Exportar backup / PDF / CSV e compartilhar | `@capacitor/filesystem` + `@capacitor/share` |
| Bloqueio ao voltar do segundo plano | `@capacitor/app` |
| Aviso de proventos anunciados com o app fechado | `@capacitor/background-runner` (`www/runners/background.js`) |
| Cotações (brapi / Yahoo) e IA sem bloqueio de CORS | `CapacitorHttp` (nativo, ativado em `capacitor.config.json`) |

Os dados continuam só no aparelho (IndexedDB do WebView); o backup do Android está desligado
(`allowBackup="false"`) — use o backup do próprio app.

## Baixar o APK pronto

Todo push que altera `android-app/` roda o workflow **Android (Grefinacia)** no GitHub Actions.
Abra a execução em *Actions* e baixe o artefato **grefinacia-debug-apk**; instale no celular
(permitindo "fontes desconhecidas").

Para gerar APK/AAB **de release assinados** (Play Store), cadastre estes *secrets* no repositório:
`ANDROID_KEYSTORE_BASE64` (o `.jks` em base64), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`. O artefato **grefinacia-release** aparece em seguida.

```bash
# criar uma keystore (uma vez) e converter para o secret
keytool -genkeypair -v -keystore release.jks -alias grefinacia -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 release.jks
```

## Compilar localmente

Pré-requisitos: Node 22+, JDK 21 e Android SDK (Android Studio).

```bash
cd android-app
npm ci
npm run build:debug          # gera android/app/build/outputs/apk/debug/app-debug.apk
# ou abra no Android Studio:
npx cap sync android && npx cap open android
```

Para release local, crie `android/keystore.properties` (fica fora do Git):

```properties
storeFile=/caminho/release.jks
storePassword=...
keyAlias=grefinacia
keyPassword=...
```

## Atualizar o app web

1. Gere um novo build do Grefinacia (ou baixe o HTML do artifact) e substitua `www/index.html`
   (mantendo um único `<div id="root">` e o `<script type="module">` inline).
2. `npx cap sync android` e recompile.

Ícone e splash vêm de `assets/` (SVGs editáveis + PNGs); para regerar:
`npx capacitor-assets generate --android --iconBackgroundColor '#0b0f17' --splashBackgroundColor '#0b0f17'`.
