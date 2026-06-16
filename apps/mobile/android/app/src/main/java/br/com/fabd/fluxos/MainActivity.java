package br.com.fabd.fluxos;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import androidx.core.app.ActivityCompat;

import com.getcapacitor.BridgeActivity;

/**
 * MainActivity custom — pede permissao POST_NOTIFICATIONS direto no onCreate,
 * bypassando o plugin @capacitor/local-notifications.
 *
 * Necessario porque o app usa server.url pra carregar URL externa
 * (https://fluxos.fabd.com.br) no WebView. Quando JS vem de origem
 * remota, runtime permission requests do plugin Capacitor podem nao
 * acionar o popup nativo do Android (ainda que POST_NOTIFICATIONS esteja
 * declarada no AndroidManifest). Chamar ActivityCompat.requestPermissions
 * diretamente da Activity garante que o popup aparece na primeira abertura
 * apos instalacao em Android 13+.
 */
public class MainActivity extends BridgeActivity {
    private static final int NOTIFICATION_PERMISSION_REQUEST_CODE = 1001;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin de atualizacao in-app (baixa APK + abre instalador). Tem que
        // ser registrado ANTES de super.onCreate pra entrar na bridge Capacitor.
        registerPlugin(ApkInstallerPlugin.class);
        super.onCreate(savedInstanceState);
        requestNotificationPermissionIfNeeded();
    }

    private void requestNotificationPermissionIfNeeded() {
        // POST_NOTIFICATIONS so existe a partir do Android 13 (API 33)
        if (Build.VERSION.SDK_INT >= 33) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                    this,
                    new String[]{Manifest.permission.POST_NOTIFICATIONS},
                    NOTIFICATION_PERMISSION_REQUEST_CODE
                );
            }
        }
    }
}
