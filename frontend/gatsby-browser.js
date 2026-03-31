import React from "react";
import "antd/dist/reset.css";
import "./src/styles/global.css";

import AuthProvider from "./src/hooks/provider";
import { RouteGuard } from "./src/auth/RouteGuard";

export const wrapRootElement = AuthProvider;

export const wrapPageElement = ({ element }) => {
  return <RouteGuard>{element}</RouteGuard>;
};
