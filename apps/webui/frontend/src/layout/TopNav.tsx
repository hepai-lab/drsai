import { Dropdown, Input, Tooltip } from "antd";
import { MoonIcon, SunIcon } from "@heroicons/react/24/outline";
import {
  BookOpen,
  Github,
  LogOut,
  Menu,
  Search,
  User,
} from "lucide-react";
import React, { useContext, useState } from "react";
import { appContext } from "../hooks/provider";
import { useLang } from "../i18n/useLang";
import UserProfileModal from "../components/userProfile";
import { clearAuthSession } from "../utils/authSession";

interface TopNavProps {
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
}

const TopNav: React.FC<TopNavProps> = ({ onToggleSidebar }) => {
  const { user, darkMode, setDarkMode } = useContext(appContext);
  const { lang, toggleLang, t } = useLang();
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  const handleLogout = () => {
    clearAuthSession();
    if (process.env.GATSBY_SERVICE_MODE === "DEV") {
      window.location.href = "/login";
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
        {/* Left: menu + logo */}
        <div className="flex items-center gap-1 flex-shrink-0 min-w-0">
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={t("topnav.menu.aria")}
            className="lg:hidden flex items-center justify-center w-9 h-9 rounded-xl text-primary hover:text-accent hover:bg-tertiary/30 transition-all"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2 px-1 lg:px-2.5 py-1 min-w-0">
            <img
              src="https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview"
              alt="Dr.Sai Logo"
              className="w-6 h-6 rounded-md object-cover flex-shrink-0"
            />
            <span className="text-sm font-semibold tracking-wide text-primary whitespace-nowrap hidden sm:inline">
              OpenDrSai
            </span>
          </div>
        </div>

        <div className="flex-1 min-w-0" />

        {/* Right: search + theme + lang + github + docs + user */}
        <div className="flex items-center gap-0.5 lg:gap-1 flex-shrink-0">
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

          <Tooltip title="GitHub">
            <a
              href="https://github.com/hepai-lab/drsai"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center justify-center w-9 h-9 rounded-xl text-primary hover:text-accent hover:bg-tertiary/30 transition-all"
            >
              <Github className="w-5 h-5 stroke-[2]" />
            </a>
          </Tooltip>

          <Tooltip title={t("topnav.docs")}>
            <a
              href="https://docs-drsai.ihep.ac.cn/"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center justify-center w-9 h-9 rounded-xl text-primary hover:text-accent hover:bg-tertiary/30 transition-all"
            >
              <BookOpen className="w-5 h-5 stroke-[2]" />
            </a>
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
                  ...(localStorage.getItem("drsai_is_science_user") !== "1"
                    ? [
                        { type: "divider" as const },
                        {
                          key: "logout",
                          label: t("topnav.logout"),
                          icon: <LogOut className="w-4 h-4" />,
                          onClick: handleLogout,
                          danger: true,
                        },
                      ]
                    : []),
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
