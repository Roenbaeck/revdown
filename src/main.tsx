import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import "katex/dist/katex.min.css";
import "./styles/global.css";

document.documentElement.dataset.platform = /Macintosh|Mac OS X/u.test(
  window.navigator.userAgent,
)
  ? "macos"
  : "other";
document.documentElement.dataset.windowFullscreen = "false";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
