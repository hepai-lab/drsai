import { Dropdown, Input, Tooltip } from "antd";
import { MoonIcon, SunIcon } from "@heroicons/react/24/outline";
import {
  BookOpen,
  Github,
  LogOut,
  PanelLeftOpen,
  Search,
  User,
} from "lucide-react";
import React, { useContext, useEffect, useState } from "react";
import { appContext } from "../hooks/provider";
import { Button } from "../components/common/Button";
import UserProfileModal from "../components/userProfile";

interface TopNavProps {
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  onLogoClick: () => void;
}

const TopNav: React.FC<TopNavProps> = ({
  isSidebarOpen,
  onToggleSidebar,
  onLogoClick,
}) => {
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
        className={`flex-shrink-0 flex items-center h-14 px-3 border-b ${darkMode === "dark"
          ? "bg-[#0f0f0f] border-border-primary/50"
          : "bg-white border-gray-200/80"
          } z-[70]`}
      >
        {/* Left: open-sidebar button (only when closed) + logo + title */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* {!isSidebarOpen && (
            <Tooltip title="Open Sidebar">
              <Button
                variant="tertiary"
                size="sm"
                icon={<PanelLeftOpen strokeWidth={1.5} className="h-5 w-5" />}
                onClick={onToggleSidebar}
                className="!px-1 transition-colors hover:text-accent"
              />
            </Tooltip>
          )} */}
          <div
            className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={onLogoClick}
          >
            <img
              src="https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview"
              alt="Dr.Sai Logo"
              className="w-6 h-6 rounded-md object-cover"
            />
            <span className="text-base font-semibold text-primary whitespace-nowrap">
              OpenDrSai
            </span>
          </div>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right: search + theme + lang + github + docs + user */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Search */}
          <Input
            prefix={<Search className="w-4 h-4 text-secondary" />}
            placeholder={lang === "zh" ? "搜索..." : "Search..."}
            className="w-64 rounded-lg mr-2"
            allowClear
          />

          {/* Theme toggle */}
          <Tooltip
            title={
              darkMode === "dark"
                ? lang === "zh" ? "切换亮色" : "Light mode"
                : lang === "zh" ? "切换暗色" : "Dark mode"
            }
          >
            <button
              onClick={() => setDarkMode(darkMode === "dark" ? "light" : "dark")}
              className="flex items-center justify-center w-9 h-9 rounded-lg text-primary hover:text-accent hover:bg-tertiary/20 transition-all"
            >
              {darkMode === "dark" ? (
                <SunIcon className="w-5 h-5" />
              ) : (
                <MoonIcon className="w-5 h-5" />
              )}
            </button>
          </Tooltip>

          {/* Language toggle */}
          <Tooltip title={lang === "zh" ? "Switch to English" : "切换为中文"}>
            <button
              onClick={toggleLang}
              className="flex items-center justify-center w-9 h-9 rounded-lg text-primary hover:text-accent hover:bg-tertiary/20 transition-all text-sm font-medium"
            >
              {lang === "zh" ? "EN" : "中"}
            </button>
          </Tooltip>

          {/* GitHub */}
          <Tooltip title="GitHub">
            <a
              href="https://github.com/hepai-lab/drsai"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center w-9 h-9 rounded-lg text-primary hover:text-accent transition-all"
            >
              <Github className="w-5 h-5 stroke-[2]" />
            </a>
          </Tooltip>

          {/* Docs */}
          <Tooltip title={lang === "zh" ? "文档" : "Documentation"}>
            <a
              href="https://docs-drsai.ihep.ac.cn/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center w-9 h-9 rounded-lg text-primary hover:text-accent transition-all"
            >
              <BookOpen className="w-5 h-5 stroke-[2]" />
            </a>
          </Tooltip>

          {/* User dropdown */}
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
              <button className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm font-medium transition-colors text-secondary hover:text-accent hover:bg-tertiary/20 ml-1">
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
                {/* <span className="max-w-[120px] truncate hidden sm:block">
                  {user.name || user.email}
                </span> */}
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
