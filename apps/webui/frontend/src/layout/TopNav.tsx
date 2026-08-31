import { Dropdown, Input, Tooltip } from "antd";
import { MoonIcon, SunIcon } from "@heroicons/react/24/outline";
import {
  BookOpen,
  ChevronDown,
  Github,
  LogOut,
  Menu,
  Search,
  User,
} from "lucide-react";
import React, { useContext, useMemo, useState } from "react";
import { appContext } from "../hooks/provider";
import { useLocation, useNavigate } from "../hooks/useRouter";
import { useLang } from "../i18n/useLang";
import UserProfileModal from "../components/userProfile";
import { clearAuthSession, logoutRequest } from "../utils/authSession";

const DOCS_URL = "https://docs-drsai.ihep.ac.cn/";
const GITHUB_URL = "https://github.com/hepai-lab/drsai";
const LOGO_URL =
  "https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview";

interface TopNavProps {
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
}

const normalizePath = (path: string) => path.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";

const TopNav: React.FC<TopNavProps> = ({ onToggleSidebar }) => {
  const { user, darkMode, setDarkMode } = useContext(appContext);
  const { lang, toggleLang, t } = useLang();
  const location = useLocation();
  const navigate = useNavigate();
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  const isProductPage = normalizePath(location.pathname) === "/welcome";

  const navLinkClass = (active: boolean) =>
    `text-sm font-semibold px-2.5 sm:px-3 py-1.5 rounded-lg transition-colors ${
      active
        ? darkMode === "dark"
          ? "text-accent cursor-default"
          : "text-violet-700 cursor-default"
        : darkMode === "dark"
          ? "text-secondary hover:text-primary hover:bg-white/5"
          : "text-secondary hover:text-violet-700 hover:bg-violet-50"
    }`;

  const resourcesMenuItems = useMemo(
    () => [
      {
        key: "docs",
        label: (
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center"
          >
            {t("topnav.docs")}
          </a>
        ),
        icon: <BookOpen className="w-4 h-4" />,
      },
      {
        key: "github",
        label: (
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center"
          >
            GitHub
          </a>
        ),
        icon: <Github className="w-4 h-4" />,
      },
    ],
    [t]
  );

  const handleLogout = async () => {
    await logoutRequest();
    clearAuthSession();
    if (process.env.GATSBY_SERVICE_MODE === "DEV") {
      window.location.href = "/login?logout=1";
    } else {
      window.location.href = "/umt/logout";
    }
  };

  return (
    <>
      <div
        className={`flex-shrink-0 flex items-center h-12 lg:h-14 px-2 lg:px-3 ${
          darkMode === "dark"
            ? "bg-[#0f0f0f]/65 backdrop-blur-md shadow-[0_12px_28px_-24px_rgba(0,0,0,0.95)]"
            : "bg-white/70 border-b border-gray-200/80 backdrop-blur-md"
        } z-[70]`}
      >
        {/* Left: mobile menu */}
        <div className="flex w-9 flex-shrink-0 items-center lg:w-0 lg:overflow-hidden">
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={t("topnav.menu.aria")}
            className="lg:hidden flex items-center justify-center w-9 h-9 rounded-xl text-primary hover:text-accent hover:bg-tertiary/30 transition-all"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>

        {/* Center: Logo · Product · Resources (left-aligned in main area) */}
        <div className="flex flex-1 items-center min-w-0 px-1 sm:px-2">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
              <img
                src={LOGO_URL}
                alt=""
                className="w-5 h-5 sm:w-6 sm:h-6 rounded-md object-cover flex-shrink-0"
              />
              <span className="text-xs sm:text-sm font-semibold tracking-wide text-primary whitespace-nowrap">
                OpenDrSai
              </span>
            </div>

            {isProductPage ? (
              <span className={`${navLinkClass(true)} inline-flex text-xs sm:text-sm flex-shrink-0`} aria-current="page">
                {t("topnav.product")}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => navigate("/welcome")}
                className={`${navLinkClass(false)} inline-flex text-xs sm:text-sm flex-shrink-0`}
              >
                {t("topnav.product")}
              </button>
            )}

            <Dropdown
              trigger={["click"]}
              menu={{ items: resourcesMenuItems }}
              placement="bottomLeft"
            >
              <button
                type="button"
                className={`inline-flex items-center gap-0.5 sm:gap-1 text-xs sm:text-sm flex-shrink-0 ${navLinkClass(false)}`}
                aria-haspopup="menu"
              >
                <span>{t("topnav.resources")}</span>
                <ChevronDown className="w-3.5 h-3.5 opacity-70" />
              </button>
            </Dropdown>
          </div>
        </div>

        {/* Right: search + theme + lang + user */}
        <div className="ml-auto flex items-center gap-0.5 lg:gap-1 flex-shrink-0">
          <Input
            prefix={<Search className="w-4 h-4 text-secondary" />}
            placeholder={t("topnav.search.placeholder")}
            className={`hidden lg:block w-64 rounded-xl mr-2 ${
              darkMode === "dark"
                ? "[&_.ant-input]:!bg-white/5 [&_.ant-input]:!text-primary [&_.ant-input-affix-wrapper]:!bg-white/5 [&_.ant-input-affix-wrapper]:!border-border-primary/50"
                : "[&_.ant-input]:!bg-white/85 [&_.ant-input-affix-wrapper]:!bg-white/90 [&_.ant-input-affix-wrapper]:!border-gray-200"
            }`}
            allowClear
          />

          <Tooltip
            title={darkMode === "dark" ? t("topnav.theme.light") : t("topnav.theme.dark")}
          >
            <button
              onClick={() => setDarkMode(darkMode === "dark" ? "light" : "dark")}
              className="flex items-center justify-center w-9 h-9 rounded-xl text-primary hover:text-accent hover:bg-tertiary/30 transition-all"
            >
              {darkMode === "dark" ? (
                <SunIcon className="w-5 h-5" />
              ) : (
                <MoonIcon className="w-5 h-5" />
              )}
            </button>
          </Tooltip>

          <Tooltip title={t("topnav.lang.switch")}>
            <button
              onClick={toggleLang}
              className="flex items-center justify-center w-9 h-9 rounded-xl text-primary hover:text-accent hover:bg-tertiary/30 transition-all text-sm font-medium"
            >
              {lang === "zh" ? "EN" : "中"}
            </button>
          </Tooltip>

          {user && (
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  {
                    key: "profile",
                    label: t("topnav.profile"),
                    icon: <User className="w-4 h-4" />,
                    onClick: () => setIsProfileModalOpen(true),
                  },
                  { type: "divider" as const },
                  {
                    key: "logout",
                    label: t("topnav.logout"),
                    icon: <LogOut className="w-4 h-4" />,
                    onClick: handleLogout,
                    danger: true,
                  },
                ],
              }}
              placement="bottomRight"
            >
              <button
                className={`flex items-center gap-2 px-2 py-1.5 rounded-xl text-sm font-medium transition-colors ml-0.5 lg:ml-1 ${
                  darkMode === "dark"
                    ? "text-secondary hover:text-accent hover:bg-white/5"
                    : "text-secondary hover:text-accent hover:bg-violet-50"
                }`}
              >
                {user.avatar_url ? (
                  <img
                    className="h-6 w-6 rounded-full"
                    src={user.avatar_url}
                    alt={user.name}
                  />
                ) : (
                  <div className="h-6 w-6 rounded-full bg-accent text-white flex items-center justify-center text-xs font-medium">
                    {String(user.name || user.email || "?")
                      .charAt(0)
                      .toUpperCase()}
                  </div>
                )}
              </button>
            </Dropdown>
          )}
        </div>
      </div>

      <UserProfileModal
        isVisible={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        user={user || { name: "", email: "" }}
      />
    </>
  );
};

export default TopNav;
