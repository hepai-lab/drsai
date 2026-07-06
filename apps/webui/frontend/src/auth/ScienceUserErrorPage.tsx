import React from "react";
import { useLang } from "../i18n/useLang";

type ErrorType = "invalidToken" | "networkError" | "missingToken";

interface Props {
    errorType?: ErrorType;
}

const ScienceUserErrorPage: React.FC<Props> = ({ errorType = "invalidToken" }) => {
    const { t } = useLang();

    const msgKey = `scienceAuth.error.${errorType}` as const;

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-950 px-4">
            <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-xl shadow-lg p-8 text-center">
                {/* 图标 */}
                <div className="mx-auto mb-5 w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                    <svg
                        className="w-8 h-8 text-red-500 dark:text-red-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                        />
                    </svg>
                </div>

                <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-3">
                    {t("scienceAuth.error.title")}
                </h1>

                <p className="text-sm text-gray-600 dark:text-slate-400 mb-8 leading-relaxed">
                    {t(msgKey)}
                </p>

                <div className="flex gap-3 justify-center">
                    <button
                        type="button"
                        onClick={() => window.location.reload()}
                        className="px-5 py-2 text-sm font-semibold text-white bg-gradient-to-br from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 rounded-lg transition-all shadow shadow-blue-500/30"
                    >
                        {t("scienceAuth.error.retry")}
                    </button>
                    <button
                        type="button"
                        onClick={() => window.location.href = "mailto:support@ihep.ac.cn"}
                        className="px-5 py-2 text-sm font-semibold text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-lg transition-all"
                    >
                        {t("scienceAuth.error.contact")}
                    </button>
                </div>

                <p className="mt-6 text-xs text-gray-400 dark:text-slate-500">
                    京ICP备05002790号-1 © 中国科学院高能物理研究所
                </p>
            </div>
        </div>
    );
};

export default ScienceUserErrorPage;
