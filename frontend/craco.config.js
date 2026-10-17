// craco.config.js – Create React App overrides: the "@/..." import alias and lint rules.
const path = require("path");

module.exports = {
  eslint: {
    configure: {
      extends: ["plugin:react-hooks/recommended"],
      rules: {
        "react-hooks/rules-of-hooks": "error",
        "react-hooks/exhaustive-deps": "warn",
      },
    },
  },
  webpack: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // The hosted preview (REACT_APP_DEMO=true) swaps in an in-browser API with sample data; production gets a stub.
      "@demo": path.resolve(__dirname, process.env.REACT_APP_DEMO === "true" ? "src/demo/index.js" : "src/demo-stub.js"),
    },
    configure: (config) => {
      config.watchOptions = { ...config.watchOptions, ignored: ["**/node_modules/**", "**/.git/**", "**/build/**"] };
      return config;
    },
  },
  devServer: (devServerConfig) => {
    // Local development: send /api to the backend so cookies stay same-origin (yarn start + uvicorn on :8001).
    devServerConfig.proxy = { "/api": { target: process.env.DEV_API_PROXY || "http://localhost:8001", changeOrigin: false } };
    return devServerConfig;
  },
};
