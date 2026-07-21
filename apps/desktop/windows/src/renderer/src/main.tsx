import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import drsaiLogo from "./assets/drsai.png";
import { hasDesktopApi } from "./desktopApi";
import { installMockDesktopApi } from "./mockDesktopApi";
import "./styles.css";

if (import.meta.env.DEV || new URLSearchParams(window.location.search).get("structuredVisualFixture") === "1") {
  installMockDesktopApi();
}

function BridgeUnavailable(): React.JSX.Element {
  return (
    <main className="bridge-unavailable">
      <section>
        <div className="brand-mark">
          <img src={drsaiLogo} alt="" />
        </div>
        <h1>OpenDrSai desktop bridge is unavailable</h1>
        <p>Restart OpenDrSai from the installed desktop shortcut.</p>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {hasDesktopApi() ? (
      <AuthProvider>
        <App />
      </AuthProvider>
    ) : (
      <BridgeUnavailable />
    )}
  </React.StrictMode>,
);
