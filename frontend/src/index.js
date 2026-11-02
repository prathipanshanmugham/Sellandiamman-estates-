import { bootDemo, DemoLayer } from "@demo"; // first, so the preview's clock and API are ready before the app loads
import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "@fontsource/outfit/500.css";
import "@fontsource/outfit/600.css";
import "@fontsource/outfit/700.css";
import "leaflet/dist/leaflet.css";
import "@/index.css";
import App from "@/App";

if (bootDemo) bootDemo();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App>{DemoLayer ? <DemoLayer /> : null}</App>
  </React.StrictMode>,
);
