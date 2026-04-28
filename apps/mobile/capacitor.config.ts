import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "br.com.fabd.fluxos",
  appName: "FABD Fluxos",
  webDir: "www",
  server: {
    // Carrega o app diretamente da URL de producao no WebView (one codebase, three platforms).
    url: "https://fluxos.fabd.com.br",
    cleartext: false,
    androidScheme: "https",
    allowNavigation: [
      "fluxos.fabd.com.br",
      "*.supabase.co",
      "accounts.google.com",
      "lh3.googleusercontent.com",
    ],
  },
  android: {
    backgroundColor: "#0F172A",
    overrideUserAgent: undefined,
  },
  plugins: {
    StatusBar: {
      backgroundColor: "#1E3A8A",
      style: "DARK",
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
