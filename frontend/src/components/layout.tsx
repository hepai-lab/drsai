import { ConfigProvider, theme } from "antd";
import "antd/dist/reset.css";
import * as React from "react";
import { appContext } from "../hooks/provider";
import { useConfigStore } from "../hooks/store";
import { SessionManager } from "./views/manager";

const classNames = (...classes: (string | undefined | boolean)[]) => {
  return classes.filter(Boolean).join(" ");
};

type Props = {
  title: string;
  link: string;
  children?: React.ReactNode;
  showHeader?: boolean;
  restricted?: boolean;
  meta?: any;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
};

const MagenticUILayout = ({
  meta,
  title,
  link,
  showHeader = true,
  restricted = false,
  activeTab,
  onTabChange,
}: Props) => {
  const { darkMode, user, setUser } = React.useContext(appContext);
  const { sidebar } = useConfigStore();
  const { isExpanded } = sidebar;
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);


  React.useEffect(() => {

    // 检查用户信息是否存在
    if (!user) {
      // 如果没有用户信息，尝试从本地存储获取
      const email = localStorage.getItem("user_email") || "guestuser@gmail.com";
      const name = localStorage.getItem("user_name") || email;
      if (email) {
        setUser({ ...user, email, name });

        // 如果是新用户登录（没有持久化的agent选择），清除之前的agent选择
        const hasPersistedAgent = localStorage.getItem("drsai-mode-config");
        if (!hasPersistedAgent) {
          localStorage.removeItem("drsai-mode-config");
        }
      } else {

        if (typeof window !== "undefined" && process.env.GATSBY_SSO === "true") {

          // TODO: 单点登录后续再接入
          window.location.href = "/sso-login";
        }
      }
    }

  }, [user, setUser]);

  // Close mobile menu on route change
  React.useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [link]);

  React.useEffect(() => {
    document.getElementsByTagName("html")[0].className = `${darkMode === "dark" ? "dark bg-primary" : "light bg-primary"
      }`;
  }, [darkMode]);

  const layoutContent = (
    <div className="h-screen flex bg-primary overflow-hidden">
      {/* Content area */}
      <div
        className={classNames(
          "flex-1 flex flex-col h-full",
          "transition-smooth",

        )}
      >
        <ConfigProvider
          theme={{
            token: {
              borderRadius: 12,
              colorBgBase: darkMode === "dark" ? "#0f0f0f" : "#ffffff",
            },
            algorithm:
              darkMode === "dark"
                ? theme.darkAlgorithm
                : theme.defaultAlgorithm,
          }}
        >
          <main className="flex-1 text-primary flex flex-col" style={{ height: "100%" }}>
            <div className="flex-1 min-h-0">
              <SessionManager />
            </div>
            {/* <div className="text-xs sm:text-sm text-secondary/60 py-2 text-center px-4 flex-shrink-0">
              Dr. Sai can make mistakes. Please monitor its work and intervene if
              necessary. (Powered by Magentic UI)
            </div> */}
          </main>
        </ConfigProvider>
      </div>
    </div>
  );

  if (restricted) {
    return (
      <appContext.Consumer>
        {(context: any) => {
          if (context.user) {
            return layoutContent;
          }
          return null;
        }}
      </appContext.Consumer>
    );
  }

  return layoutContent;
};

export default MagenticUILayout;
