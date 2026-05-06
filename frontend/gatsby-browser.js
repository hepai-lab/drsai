import React from "react";
import "antd/dist/reset.css";
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
