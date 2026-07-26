const { app, net } = require("electron");

const manifestUrl =
  "https://download-opendrsai.ihep.ac.cn/channels/beta/latest-windows.json";

app.whenReady().then(async () => {
  const results = {};
  try {
    const response = await fetch(manifestUrl, { cache: "no-store" });
    results.globalFetch = {
      status: response.status,
      version: (await response.json()).version,
    };
  } catch (error) {
    results.globalFetch = { error: error instanceof Error ? error.message : String(error) };
  }

  try {
    const response = await net.fetch(manifestUrl, { cache: "no-store" });
    results.netFetch = {
      status: response.status,
      version: (await response.json()).version,
    };
  } catch (error) {
    results.netFetch = { error: error instanceof Error ? error.message : String(error) };
  }

  console.log(JSON.stringify(results));
  app.exit(results.globalFetch?.version === "1.5.2" ? 0 : 1);
});
