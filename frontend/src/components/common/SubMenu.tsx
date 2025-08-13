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
    <div className="w-full border-b border-secondary">
      {items.map((item) => (
        <button
          key={item.id}
          className={` text-left py-1 pl-1 px-2 text-lg font-semibold  flex items-center rounded-md mx-2 
            ${activeItem === item.id
              ? "font-bold text-white bg-magenta-800"
              : "font-semibold text-gray-700 hover:text-magenta-700 "
            }`}
          onClick={() => onClick(item.id)}
        >
          {item.icon && (
            <span
              className={`mr-4 text-xl ${activeItem === item.id
                ? "text-white"
                : "text-magenta-600"
                }`}
            >
              {item.icon}
            </span>
          )}
          <span className="tracking-wide font-semibold">
            {item.label}
          </span>
        </button>
      ))}
    </div>
  );
}

export default SubMenu;
