/**
 * The workbench renderer entry point.
 *
 * Separate from `src/main.tsx` (the legacy entry) so both can be built and run
 * during the migration.  They share nothing but the React runtime: this tree
 * imports only `src/workbench/**` and the two contract files in `shared/api/`,
 * which is what makes it
 * possible to say precisely what this surface depends on.
 */

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { hasBridge } from "./bridge";
import "./styles.css";

function BridgeUnavailable(): React.JSX.Element {
  return (
    <main className="wb-bridge-unavailable">
      <h1>OpenDrSai desktop bridge is unavailable</h1>
      <p>Restart OpenDrSai from the installed desktop shortcut.</p>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{hasBridge() ? <App /> : <BridgeUnavailable />}</React.StrictMode>,
);
