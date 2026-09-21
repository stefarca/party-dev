import { createRoot } from "react-dom/client";

import "./i18n";
import { App } from "./App";
import { listenForInstallPrompt } from "./install";
import { followNotificationClicks } from "./push";

const root = document.getElementById("root");
if (!root) {
  throw new Error("missing #root element");
}

followNotificationClicks();
listenForInstallPrompt();
createRoot(root).render(<App />);
