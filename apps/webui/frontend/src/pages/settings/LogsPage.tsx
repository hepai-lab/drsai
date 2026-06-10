import React from "react";
import { useLang } from "../../i18n/useLang";

const LogsPage: React.FC = () => {
  const { t } = useLang();
  return (
    <div className="flex items-center justify-center h-full text-secondary">
      <div className="text-center">
        <h2 className="text-base font-medium text-primary">{t("logsPage.title")}</h2>
        <p className="mt-2 text-sm opacity-60">{t("logsPage.placeholder")}</p>
      </div>
    </div>
  );
};

export default LogsPage;
