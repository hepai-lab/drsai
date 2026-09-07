import React, { useState } from "react";
import fallbackLogo from "../../assets/logo.png";

const REMOTE_LOGO_URL =
  "https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview";

export function BrandLogo({
  className,
  alt = "",
}: {
  className?: string;
  alt?: string;
}) {
  const [src, setSrc] = useState(REMOTE_LOGO_URL);

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => {
        setSrc((current) => (current === fallbackLogo ? current : fallbackLogo));
      }}
    />
  );
}
