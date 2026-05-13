import React from "react";
import "antd/dist/reset.css";
/* Self-hosted fonts — avoids blocked fonts.googleapis.com on some networks */
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "@fontsource/plus-jakarta-sans/800.css";
import "@fontsource/jetbrains-mono/500.css";
import "./src/styles/global.css";

import AuthProvider from "./src/hooks/provider";
import { RouteGuard } from "./src/auth/RouteGuard";
import { StyleProvider, createCache } from "@ant-design/cssinjs";

const antdStyleCache = createCache();

export const wrapRootElement = ({ element }) => {
  return (
    <StyleProvider cache={antdStyleCache} hashPriority="high">
      <AuthProvider element={element} />
    </StyleProvider>
  );
};

export const wrapPageElement = ({ element }) => {
  return <RouteGuard>{element}</RouteGuard>;
};
