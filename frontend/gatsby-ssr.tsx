import React from "react";
import AuthProvider from "./src/hooks/provider";
import { StyleProvider, createCache, extractStyle } from "@ant-design/cssinjs";
import { renderToString } from "react-dom/server";

const codeToRunOnClient = `(function() {
  try {
    var mode = localStorage.getItem('darkmode');
    document.getElementsByTagName("html")[0].className === 'dark' ? 'dark' : 'light';
  } catch (e) {}
})();`;

export const wrapRootElement = ({ element }: any) => {
  return <AuthProvider element={element} />;
};

export const wrapPageElement = ({ element, props }: any) => {
  // This app is primarily client-driven (localStorage/websocket/antd).
  // During static HTML build, render a minimal shell to avoid SSR-only crashes.
  // The real UI hydrates on the client.
  void props;
  void element;
  return <div />;
};

export const replaceRenderer = ({
  bodyComponent,
  replaceBodyHTMLString,
  setHeadComponents,
}: any) => {
  // Custom replaceRenderer breaks Gatsby develop client routing; keep it for production builds only.
  if (process.env.NODE_ENV === "development") {
    return;
  }

  const cache = createCache();
  const bodyHTML = renderToString(
    <StyleProvider cache={cache} hashPriority="high">
      {bodyComponent}
    </StyleProvider>
  );
  replaceBodyHTMLString(bodyHTML);
  setHeadComponents([
    <style
      key="antd-cssinjs"
      data-antd="true"
      dangerouslySetInnerHTML={{ __html: extractStyle(cache, true) }}
    />,
  ]);
};

export const onRenderBody = ({ setHeadComponents }) =>
  setHeadComponents([
    <meta
      key="viewport"
      name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover"
    />,
    <script
      key="myscript"
      dangerouslySetInnerHTML={{ __html: codeToRunOnClient }}
    />,
  ]);
