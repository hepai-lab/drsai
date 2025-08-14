import React, { ReactNode } from "react";

export interface SubMenuItemProps<T> {
  id: T;
  label: string;
  icon?: ReactNode;
}

interface SubMenuProps<T> {
  items: SubMenuItemProps<T>[];
  activeItem: T;
  onClick: (id: T) => void;
}

function SubMenu<T extends string>({
  activeItem,
  onClick,
  items,
}: SubMenuProps<T>) {
  return (
    <div className="w-full">
      <div className="grid grid-cols-1 gap-2">
        {items.map((item, index) => (
          <button
            key={item.id}
            className={`group relative flex items-center gap-3 px-4 py-2 rounded-xl text-sm font-medium transition-smooth hover-lift ${activeItem === item.id
              ? "bg-gradient-primary text-white shadow-modern-lg"
              : "text-secondary hover:text-accent hover:bg-tertiary/30 backdrop-blur-sm"
              }`}
            onClick={() => onClick(item.id)}
            style={{ animationDelay: `${index * 0.1}s` }}
          >
            {/* 活跃状态指示器 */}
            <div
              className={`absolute left-0 top-1/2 transform -translate-y-1/2 w-1 h-6 rounded-r-full transition-smooth ${activeItem === item.id
                ? "bg-white opacity-100"
                : "bg-accent opacity-0 group-hover:opacity-50"
                }`}
            />

            {/* 图标容器 */}
            <div
              className={`flex items-center justify-center w-8 h-8 rounded-lg transition-smooth ${activeItem === item.id
                ? "bg-white/20 text-white"
                : "bg-tertiary/50 text-secondary group-hover:bg-accent/20 group-hover:text-accent"
                }`}
            >
              {item.icon}
            </div>

            {/* 标签 */}
            <span className="flex-1 text-left font-semibold tracking-wide">
              {item.label}
            </span>

            {/* 活跃状态装饰 */}
            {activeItem === item.id && (
              <div className="w-2 h-2 rounded-full bg-white animate-pulse-glow" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export default SubMenu;
