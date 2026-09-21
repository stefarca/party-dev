import { createRoot } from "react-dom/client";

import "./i18n";
import { App } from "./App";
import { followNotificationClicks } from "./push";

const root = document.getElementById("root");
if (!root) {
  throw new Error("missing #root element");
}

followNotificationClicks();
createRoot(root).render(<App />);
