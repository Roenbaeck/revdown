import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import "katex/dist/katex.min.css";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
