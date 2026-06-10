import React from "react";
import { Spin } from "antd";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "tertiary"
  | "success"
  | "warning"
  | "danger"
  | "ghost"
  | "gradient";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: "left" | "right";
  fullWidth?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export const Button: React.FC<ButtonProps> = ({
  variant = "primary",
  size = "md",
  isLoading = false,
  icon,
  iconPosition = "left",
  fullWidth = false,
  disabled = false,
  children,
  className = "",
  ...props
}) => {
  // Base classes shared by all buttons
  const hasNoFocus = className.includes('sidebar-dropdown-button');
  const baseClasses = hasNoFocus
    ? "inline-flex items-center justify-center rounded-xl transition-smooth focus:outline-none hover-lift"
    : "inline-flex items-center justify-center rounded-xl transition-smooth focus:outline-none focus:ring-2 focus:ring-accent/20 hover-lift";

  // Size variations
  const sizeClasses = {
    xs: "px-3 py-1.5 text-xs font-medium",
    sm: "px-4 py-2 text-sm font-medium",
    md: "px-6 py-3 text-base font-semibold",
    lg: "px-8 py-4 text-lg font-semibold",
  };

  // Variant classes - using modern design tokens
  const variantClasses = {
    primary:
      "bg-accent text-white hover:bg-accent/90 shadow-modern hover:shadow-modern-lg",
    secondary:
      "bg-tertiary/50 border-2 border-border-primary text-primary hover:bg-tertiary/70 hover:border-accent/50 backdrop-blur-sm",
    tertiary:
      "bg-transparent text-secondary hover:text-accent hover:bg-tertiary/30",
    success:
      "bg-success-primary text-white hover:bg-success-primary/90 shadow-modern hover:shadow-modern-lg",
    warning:
      "bg-warning-primary text-white hover:bg-warning-primary/90 shadow-modern hover:shadow-modern-lg",
    danger:
      "bg-error-primary text-white hover:bg-error-primary/90 shadow-modern hover:shadow-modern-lg",
    ghost:
      "bg-transparent text-secondary hover:text-accent hover:bg-accent/10",
    gradient:
      "bg-gradient-primary text-white hover:shadow-modern-lg pulse-glow",
  };

  // States
  const stateClasses =
    disabled || isLoading ? "opacity-50 cursor-not-allowed transform-none" : "cursor-pointer";

  // Width
  const widthClass = fullWidth ? "w-full" : "";

  return (
    <button
      disabled={disabled || isLoading}
      className={`
        ${baseClasses}
        ${sizeClasses[size]}
        ${variantClasses[variant]}
        ${stateClasses}
        ${widthClass}
        ${className}
      `}
      {...props}
    >
      {isLoading && (
        <div className={`animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full ${children ? "mr-2" : ""}`} />
      )}

      {!isLoading && icon && iconPosition === "left" && (
        <span className={`${children ? "mr-2" : ""}`}>{icon}</span>
      )}

      {children}

      {!isLoading && icon && iconPosition === "right" && (
        <span className={`${children ? "ml-2" : ""}`}>{icon}</span>
      )}
    </button>
  );
};
