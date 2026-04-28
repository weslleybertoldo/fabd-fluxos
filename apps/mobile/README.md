# FABD Fluxos — Mobile (Capacitor)

Wrapper Android do app web. WebView carrega `https://fluxos.fabd.com.br` direto (mesma codebase que o web).

## Setup inicial (uma vez)

```sh
cd apps/mobile
pnpm install
npx cap add android
```

## Sincronizar (sempre que mudar config ou plugins)

```sh
pnpm mobile:sync
```

## Abrir no Android Studio

```sh
pnpm mobile:open
```

## Build APK

No Android Studio: **Build → Build Bundle(s)/APK(s) → Build APK(s)**.

Saida: `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`

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
