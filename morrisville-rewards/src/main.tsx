import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { startViewportFit } from "./lib/viewportFit";
import App from "./App";
import { ToastProvider } from "./components/ui";
import "./styles/tokens.css";
import "./styles/ui.css";
import "./styles/app.css";

startViewportFit();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
