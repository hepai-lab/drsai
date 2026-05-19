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
import React, { useContext, useEffect, useState } from "react";
import { appContext } from "../hooks/provider";
import UserProfileModal from "../components/userProfile";

interface TopNavProps {
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
}

const TopNav: React.FC<TopNavProps> = ({ onToggleSidebar }) => {
  const { user, darkMode, setDarkMode } = useContext(appContext);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [lang, setLang] = useState<"zh" | "en">(
    () => (localStorage.getItem("drsai_lang") as "zh" | "en") || "zh"
  );

  useEffect(() => {
    console.log(user, "user");
  }, [user]);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    localStorage.removeItem("user_email");
    localStorage.removeItem("user_name");
    if (process.env.GATSBY_SERVICE_MODE === "DEV") {
      window.location.href = "/login";
    } else {
      window.location.href = "/umt/logout";
    }
  };

  const toggleLang = () => {
    const next = lang === "zh" ? "en" : "zh";
    setLang(next);
    localStorage.setItem("drsai_lang", next);
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
            aria-label="打开导航菜单"
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
            placeholder={lang === "zh" ? "搜索..." : "Search..."}
            className={`hidden lg:block w-64 rounded-xl mr-2 ${
              darkMode === "dark"
                ? "[&_.ant-input]:!bg-white/5 [&_.ant-input]:!text-primary [&_.ant-input-affix-wrapper]:!bg-white/5 [&_.ant-input-affix-wrapper]:!border-border-primary/50"
                : "[&_.ant-input]:!bg-white/85 [&_.ant-input-affix-wrapper]:!bg-white/90 [&_.ant-input-affix-wrapper]:!border-gray-200"
            }`}
            allowClear
          />

          <Tooltip
            title={
              darkMode === "dark"
                ? lang === "zh"
                  ? "切换亮色"
                  : "Light mode"
                : lang === "zh"
                  ? "切换暗色"
                  : "Dark mode"
            }
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

          <Tooltip title={lang === "zh" ? "Switch to English" : "切换为中文"}>
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

          <Tooltip title={lang === "zh" ? "文档" : "Documentation"}>
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
                    label: lang === "zh" ? "个人设置" : "Profile Settings",
                    icon: <User className="w-4 h-4" />,
                    onClick: () => setIsProfileModalOpen(true),
                  },
                  { type: "divider" as const },
                  {
                    key: "logout",
                    label: lang === "zh" ? "退出登录" : "Sign Out",
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
