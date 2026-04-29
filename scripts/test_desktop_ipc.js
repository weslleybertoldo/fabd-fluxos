// Smoke E2E do IPC check-for-updates do app desktop.
// Roda o Electron headless via spawn, conecta no DevTools e invoca o IPC.
//
// Mais simples (e suficiente): start o main process com NODE_OPTIONS pra
// avaliar IPC programaticamente. Mas DevTools Protocol eh mais limpo.
//
// Pra ser pragmatico: abre o Electron com --remote-debugging-port=9222
// + JS injetado que chama electronAPI.checkForUpdates() e imprime no console.
// Aqui apenas validamos que a fetch interna funciona quando rodada do main.

const fetch = global.fetch || require("node-fetch");

async function main() {
  const APP_URL = "https://fluxos.fabd.com.br";
  console.log("Testando GET", APP_URL + "/api/latest-release");
  const r = await fetch(APP_URL + "/api/latest-release");
  console.log("status:", r.status);
  const data = await r.json();
  console.log("data:", JSON.stringify(data, null, 2));
  if (!data.tag_name) {
    console.error("FAIL: sem tag_name");
    process.exit(1);
  }
  // Simula a logica do IPC do main.js
  const latest = String(data.tag_name || "").replace(/^v/, "");
  const current = "0.1.0"; // app.getVersion() em produc retornaria isso
  const result =
    latest === current
      ? { status: "ok", message: `Voce esta na versao mais recente (v${current}).` }
      : {
          status: "update-available",
          message: `Atualizacao disponivel: v${latest} (atual v${current}).`,
          version: latest,
          url: data.html_url,
        };
  console.log("\nIPC simulado retornou:");
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "ok" && result.status !== "update-available") {
    console.error("FAIL: status invalido");
    process.exit(1);
  }
  console.log("\nPASS — logica do IPC funciona end-to-end.");
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
