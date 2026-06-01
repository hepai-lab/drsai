import React from "react";
import { useLang } from "../../i18n/useLang";

const ChannelsPage: React.FC = () => {
  const { t } = useLang();
  return (
    <div className="flex items-center justify-center h-full text-secondary">
      <div className="text-center">
        <h2 className="text-base font-medium text-primary">{t("channelsPage.title")}</h2>
        <p className="mt-2 text-sm opacity-60">{t("channelsPage.placeholder")}</p>
      </div>
    </div>
  );
};

export default ChannelsPage;
