import React from "react";
import logo from "../../assets/logo.png";

export function BrandLogo({
  className,
  alt = "",
}: {
  className?: string;
  alt?: string;
}) {
  return <img src={logo} alt={alt} className={className} />;
}
