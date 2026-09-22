import React from "react";

const themeScript = `(function(){
  try {
    var dark = localStorage.getItem("darkmode") === "dark";
    var root = document.documentElement;
    root.className = dark ? "dark" : "light";
    root.style.setProperty("--drsai-boot-bg", dark ? "#0d1016" : "#f8f8fb");
    root.style.setProperty("--drsai-boot-fg", dark ? "#94a3b8" : "#64748b");
    root.style.backgroundColor = dark ? "#0d1016" : "#f8f8fb";
  } catch (e) {}
})();`;

const splashCss = `
@keyframes drsai-boot-spin { to { transform: rotate(360deg); } }
html, body { margin: 0; min-height: 100%; background: var(--drsai-boot-bg, #f8f8fb); }
#drsai-boot-splash {
  position: fixed;
  inset: 0;
  z-index: 99999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--drsai-boot-bg, #f8f8fb);
  color: var(--drsai-boot-fg, #64748b);
}
#drsai-boot-splash .drsai-boot-splash__inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
#drsai-boot-splash .drsai-boot-splash__spinner {
  width: 32px;
  height: 32px;
  border: 4px solid #3b82f6;
  border-top-color: transparent;
  border-radius: 50%;
  animation: drsai-boot-spin 0.7s linear infinite;
}
#drsai-boot-splash .drsai-boot-splash__text {
  margin: 0;
  font-size: 14px;
  font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif;
}
`;

export default function HTML(props) {
  return (
    <html {...props.htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="x-ua-compatible" content="ie=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <style dangerouslySetInnerHTML={{ __html: splashCss }} />
        {props.headComponents}
      </head>
      <body {...props.bodyAttributes}>
        {props.preBodyComponents}
        <div id="drsai-boot-splash" role="status" aria-live="polite" aria-label="正在加载">
          <div className="drsai-boot-splash__inner">
            <span className="drsai-boot-splash__spinner" />
            <p className="drsai-boot-splash__text">正在加载</p>
          </div>
        </div>
        <div
          key="body"
          id="___gatsby"
          dangerouslySetInnerHTML={{ __html: props.body }}
        />
        {props.postBodyComponents}
      </body>
    </html>
  );
}
