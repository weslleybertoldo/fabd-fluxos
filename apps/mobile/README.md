# @fabd-fluxos/mobile — Capacitor Android wrapper

App nativo Android que carrega https://fluxos.fabd.com.br no WebView. One codebase, three platforms (web + desktop + mobile).

## Estrutura

- `capacitor.config.ts` — config principal (appId, plugins, server URL)
- `www/index.html` — fallback estático (Capacitor exige um webDir mesmo carregando URL externa)
- `android/` — projeto nativo gerado via `cap add android`. Commitado pra preservar customizações futuras (ícones, splash, AndroidManifest)

## Build do APK

### Pré-requisitos
1. **JDK 17** (Eclipse Temurin recomendado): https://adoptium.net/
   - Setar `JAVA_HOME` apontando pro JDK
2. **Android SDK** (via Android Studio ou cmdline-tools)
   - Setar `ANDROID_HOME` apontando pro SDK
   - Aceitar licenças: `sdkmanager --licenses`

### Sincronizar config web → nativo
```bash
pnpm mobile:sync
```

### Build APK debug (distribuir manualmente, sideload)
```bash
cd apps/mobile/android
./gradlew.bat assembleDebug
```
APK fica em `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

### Build APK release (Play Store)
Precisa keystore — gerar uma vez:
```bash
keytool -genkey -v -keystore fabd-release.keystore -alias fabd -keyalg RSA -keysize 2048 -validity 10000
```
Salvar a senha em local seguro (LastPass/1Password). Configurar `android/app/build.gradle` com signingConfig referenciando a keystore. Depois:
```bash
./gradlew.bat assembleRelease
```

### Abrir no Android Studio
```bash
pnpm mobile:open
```
**Build → Build Bundle(s)/APK(s) → Build APK(s)**.

## Plugins Capacitor instalados
- `@capacitor/app` — eventos lifecycle
- `@capacitor/browser` — abrir links externos no Chrome custom tab
- `@capacitor/preferences` — storage nativo
- `@capacitor/push-notifications` — FCM (sub-fase 8D, futuro)
- `@capacitor/status-bar` — cor da status bar Android

## Deep link OAuth callback

Pra Capacitor abrir o `accounts.google.com` no browser do sistema e voltar via deep link `fabd-fluxos://auth-callback?...`:

1. Adicionar no `android/app/src/main/AndroidManifest.xml` na MainActivity:

```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="fabd-fluxos" />
</intent-filter>
```

2. No web app, na pagina de callback, detectar plataforma Capacitor e chamar `Browser.close()` apos sucesso.
