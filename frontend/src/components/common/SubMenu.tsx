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
      <div className="grid grid-cols-1 gap-1">
        {items.map((item) => (
          <button
            key={item.id}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeItem === item.id
              ? "bg-accent text-white"
              : "text-secondary hover:text-accent hover:bg-tertiary/20"
              }`}
            onClick={() => onClick(item.id)}
          >
            {/* 图标 */}
            <div className="flex items-center justify-center w-5 h-5">
              {item.icon}
            </div>

            {/* 标签 */}
            <span className="flex-1 text-left font-medium">
              {item.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default SubMenu;
