# 8D — FCM Push setup

Push notifications nativas no Android via Firebase Cloud Messaging. iOS depende de APNs configurado no Firebase + provisioning profile Apple Developer (US$ 99/ano) — não coberto agora.

## Status atual da implementação

✅ **Pronto no código** (commit `f670c00+1`):
- Migration `20260428000015_device_tokens.sql` — tabela com PK uuid, token UNIQUE, RLS proprio user
- `apps/web/src/lib/actions/fcm.ts` — `saveFcmToken`, `deleteFcmToken`, `sendFcmToUser` (Firebase Admin SDK)
- `apps/web/src/components/fcm-register.tsx` — registra device token via Capacitor PushNotifications, ignora silenciosamente em web/desktop
- Hook em `notify()` (notifications.ts) e cron (`/api/cron/notify-due-phases`) pra disparar FCM junto com Web Push e Email
- `<FcmRegister />` renderizado no layout do workspace

🟡 **Pendente — você precisa fornecer:**
1. **`FIREBASE_SERVICE_ACCOUNT`** (env var Vercel) — JSON inline ou base64 do service account
2. **`google-services.json`** em `apps/mobile/android/app/`
3. Plugin Gradle `com.google.gms.google-services` em `apps/mobile/android/build.gradle` + `apps/mobile/android/app/build.gradle`

Sem isso, `getAdminApp()` retorna null e `sendFcmToUser` faz no-op silencioso. Web Push + Email continuam funcionando.

## Setup passo-a-passo

### 1. Criar projeto Firebase
1. Login: https://console.firebase.google.com
2. **Add project** → nome `fabd-fluxos` (ou reaproveitar projeto existente)
3. Skip Google Analytics (não precisa pra FCM)
4. Aceitar termos

### 2. Adicionar app Android
1. Project overview → ícone Android
2. **Android package name**: `br.com.fabd.fluxos` (deve bater com `appId` do `capacitor.config.ts`)
3. **Nickname**: FABD Fluxos
4. **SHA-1**: opcional pra debug; obrigatório pra release com OAuth
5. Download `google-services.json`
6. Salvar em `apps/mobile/android/app/google-services.json`

### 3. Configurar Gradle plugin

Em `apps/mobile/android/build.gradle` (root), adicionar no `dependencies` do classpath:
```gradle
classpath 'com.google.gms:google-services:4.4.2'
```

Em `apps/mobile/android/app/build.gradle`, adicionar no topo:
```gradle
apply plugin: 'com.google.gms.google-services'
```

E nas dependencies:
```gradle
implementation platform('com.google.firebase:firebase-bom:33.7.0')
implementation 'com.google.firebase:firebase-messaging'
```

### 4. Service account pro backend

1. Console Firebase → **Project settings** (engrenagem) → aba **Service accounts**
2. **Generate new private key** → confirma → baixa JSON
3. Converter pra base64 (Windows PowerShell):
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("path\to\firebase-admin.json"))
   ```
4. Adicionar no Vercel:
   ```bash
   printf '<base64-output>' | vercel env add FIREBASE_SERVICE_ACCOUNT production --yes
   ```

   `apps/web/src/lib/actions/fcm.ts:getAdminApp()` aceita JSON inline OU base64 — o helper detecta automaticamente.

### 5. Rebuild APK
```powershell
$env:JAVA_HOME = "C:\Users\Usuário\jdk21\jdk-21.0.5+11"
$env:ANDROID_HOME = "C:\Users\Usuário\android-sdk"
cd apps/mobile
pnpm sync
cd android
.\gradlew.bat assembleDebug
```

APK novo em `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`. Instala no celular, abre, faz login. O `<FcmRegister>` pede permissão de notificação, recebe device token do FCM, salva via action → row aparece em `device_tokens`.

### 6. Testar

```bash
# manualmente disparar uma notif via cron endpoint
curl -X POST https://fluxos.fabd.com.br/api/cron/notify-due-phases \
  -H "Authorization: Bearer $CRON_SECRET"
```

Se houver phase vencida com responsavel que tem device token salvo, push aparece na barra de notificação Android.

## Comandos úteis

```bash
# Listar device tokens registrados (psycopg)
select user_id, platform, app_version, last_used_at from device_tokens;

# Forçar limpeza de tokens não usados há 60 dias (futura cron job)
delete from device_tokens where last_used_at < now() - interval '60 days';
```
