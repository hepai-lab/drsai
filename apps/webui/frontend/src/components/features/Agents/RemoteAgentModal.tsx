import React, { useState, useContext } from "react";
import ReactDOM from "react-dom";
import { X, Wifi, Save, Zap, CheckCircle2, AlertCircle } from "lucide-react";
import { appContext } from "../../../hooks/provider";
import { useLang } from "../../../i18n/useLang";
import { agentWorkerAPI } from "../../views/api";
import { message } from "antd";

interface RemoteAgentConfig {
  name: string;
  url: string;
  api_key: string;
}

interface RemoteAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: RemoteAgentConfig, agentInfo?: any) => void;
}

const RemoteAgentModal: React.FC<RemoteAgentModalProps> = ({
  isOpen,
  onClose,
  onSave,
}) => {
  const { darkMode, user } = useContext(appContext);
  const { t } = useLang();
  const [modalRoot, setModalRoot] = useState<HTMLElement | null>(null);
  const [formData, setFormData] = useState<RemoteAgentConfig>({
    name: "R1_test",
    url: "https://aiapi.ihep.ac.cn/apiv2",
    api_key: "",
  });
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTestPassed, setConnectionTestPassed] = useState(false);
  const [testError, setTestError] = useState<string>("");
  const [agentInfo, setAgentInfo] = useState<any>(null);

  React.useEffect(() => {
    if (isOpen) {
      const root = document.getElementById("___gatsby") || document.body;
      setModalRoot(root);
    }
  }, [isOpen]);

  const handleInputChange = (field: keyof RemoteAgentConfig, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    // Reset connection test status when form data changes
    setConnectionTestPassed(false);
    setTestError("");
  };

  const testConnection = async () => {
    if (!formData.name || !formData.url || !formData.api_key) {
      message.error(t("remoteModal.fillRequired"));
      return;
    }

    setIsTestingConnection(true);
    setTestError("");

    try {
      // 检查用户是否已登录
      if (!user?.email) {
        throw new Error("User not logged in");
      }

      // 使用后端接口测试远程智能体连接
      const testResult = await agentWorkerAPI.testRemoteAgent(
        user.email,
        formData.url,
        formData.name,
        formData.api_key // 使用用户输入的远程智能体API key
      );

      setAgentInfo(testResult);
      setConnectionTestPassed(true);
      message.success(t("remoteModal.testSuccess"));

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Connection failed";
      setTestError(errorMessage);
      message.error(t("remoteModal.testFailed") + errorMessage);
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleSave = () => {
    if (!connectionTestPassed) {
      message.error(t("remoteModal.testFirst"));
      return;
    }

    onSave(formData, agentInfo);
    message.success(t("remoteModal.saveSuccess"));
    onClose();

    // Reset form
    setFormData({ name: "", url: "", api_key: "" });
    setConnectionTestPassed(false);
    setTestError("");
    setAgentInfo(null);
  };

  const handleClose = () => {
    onClose();
    // Reset form
    setFormData({ name: "", url: "", api_key: "" });
    setConnectionTestPassed(false);
    setTestError("");
    setAgentInfo(null);
  };

  if (!isOpen || !modalRoot) return null;

  const renderInputField = (
    label: string,
    field: keyof RemoteAgentConfig,
    placeholder: string,
    type: "text" | "password" = "text"
  ) => (
    <div className="mb-3">
      <label
        className={`block text-sm font-medium mb-2 ${darkMode === "dark" ? "text-gray-300" : "text-gray-600"}`}
      >
        {label} <span className="text-red-500">*</span>
      </label>
      <input
        type={type}
        value={formData[field]}
        onChange={(e) => handleInputChange(field, e.target.value)}
        placeholder={placeholder}
        className={`w-full h-9 px-3 rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-[#4d3dc3]/40 focus:border-[#4d3dc3] ${darkMode === "dark"
          ? "bg-[#3a3a3a] text-[#e5e5e5] border-transparent placeholder:text-gray-400"
          : "bg-gray-50 text-[#2d3748] border-transparent placeholder:text-gray-400"}`}
      />
    </div>
  );

  const modalContent = (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50"
      style={{ zIndex: 1000 }}
    >
      <div
        className={`rounded-2xl shadow-2xl ${darkMode === "dark" ? "bg-[#171a21]" : "bg-white border border-gray-200"} w-[520px] max-w-[92vw] max-h-[90vh] overflow-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Wifi className="h-5 w-5 text-[#4d3dc3]" />
            <h2 className={`text-lg font-semibold ${darkMode === "dark" ? "text-[#e5e5e5]" : "text-[#2d3748]"}`}>
              {t("remoteModal.title")}
            </h2>
            {connectionTestPassed && (
              <span className="ml-1 inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                {t("remoteModal.verified")}
              </span>
            )}
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
            aria-label="Close"
          >
            <X size={18} className={darkMode === "dark" ? "text-gray-400" : "text-gray-600"} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5">

          {/* Form */}
          <form onSubmit={(e) => e.preventDefault()}>
            {renderInputField(t("remoteModal.agentName"), "name", "例如: My Remote Agent")}
            {renderInputField(t("remoteModal.serverUrl"), "url", "例如: http://localhost:42806/apiv2")}
            {renderInputField(t("remoteModal.apiKey"), "api_key", "例如: sk-xxxxxxxxxxxxxxxx", "password")}

            {/* Inline Status Messages - minimal */}
            {testError && (
              <div className="mb-3 flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                <AlertCircle className="h-4 w-4" />
                <span>{t("remoteModal.testFailed")}{testError}</span>
              </div>
            )}
            {connectionTestPassed && (
              <div className="mb-3 flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                <span>{t("remoteModal.testReady")}</span>
              </div>
            )}
          </form>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={handleClose}
            className={`px-3.5 py-1.5 text-sm font-medium rounded-lg transition-colors ${darkMode === "dark"
              ? "text-gray-300 hover:text-gray-100 hover:bg-gray-700/60"
              : "text-gray-600 hover:text-gray-800 hover:bg-gray-100"
              }`}
          >
            {t("remoteModal.cancel")}
          </button>
          <button
            onClick={testConnection}
            disabled={!formData.name || !formData.url || !formData.api_key || isTestingConnection}
            className={`px-3.5 py-1.5 text-sm font-medium rounded-lg transition-colors inline-flex items-center gap-2 border ${!formData.name || !formData.url || !formData.api_key || isTestingConnection
              ? darkMode === "dark"
                ? "border-gray-700 text-gray-500 cursor-not-allowed"
                : "border-gray-200 text-gray-400 cursor-not-allowed"
              : darkMode === "dark"
                ? "border-[#4d3dc3] text-[#e5e5ff] hover:bg-[#4d3dc3]/20"
                : "border-[#4d3dc3] text-[#4d3dc3] hover:bg-[#4d3dc3]/10"
              }`}
          >
            {isTestingConnection ? (
              <>
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                {t("remoteModal.testing")}
              </>
            ) : (
              <>
                <Zap className="h-4 w-4" />
                {t("remoteModal.testConnection")}
              </>
            )}
          </button>
          <button
            onClick={handleSave}
            disabled={!connectionTestPassed}
            className={`px-3.5 py-1.5 text-sm font-medium rounded-lg transition-colors inline-flex items-center gap-2 ${!connectionTestPassed
              ? darkMode === "dark"
                ? "bg-gray-700 text-gray-500 cursor-not-allowed"
                : "bg-gray-200 text-gray-400 cursor-not-allowed"
              : darkMode === "dark"
                ? "bg-[#4d3dc3] text-white hover:bg-[#4336b1]"
                : "bg-[#4d3dc3] text-white hover:bg-[#4336b1]"
              }`}
          >
            <Save className="h-4 w-4" />
            {t("remoteModal.save")}
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modalContent, modalRoot);
};

export default RemoteAgentModal;
