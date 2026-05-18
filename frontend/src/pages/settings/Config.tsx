import React, { useContext } from "react";
import { appContext } from "../../hooks/provider";
import {
  Tabs,
  Select,
  Switch,
  Input,
  Button,
  Tag,
  Space,
  Divider,
  Tooltip,
  Upload,
  message,
  Modal,
} from "antd";
import { InfoCircleOutlined, UploadOutlined } from "@ant-design/icons";
import { Plus } from "lucide-react";
import MonacoEditor from "@monaco-editor/react";
import { useSettingsStore, generateOpenAIModelConfig } from "../../components/store";
import { settingsAPI } from "../../components/views/api";
import { MODEL_OPTIONS } from "../../components/settings";
import {
  clearMessageCache,
  clearDrSaiStorage,
  getStorageUsageString,
} from "../../utils/storageUtils";

type UserLike = { name?: string; email?: string; avatar_url?: string };

// ── 个人信息 ──────────────────────────────────────────────────────────────────

const ProfileSection: React.FC<{ user: UserLike }> = ({ user }) => {
  const { darkMode } = useContext(appContext);
  const initial = String(user.name || user.email || "?").charAt(0).toUpperCase();

  return (
    <div className="flex justify-center pt-6">
      <div
        className={`w-full max-w-sm rounded-2xl border shadow-modern overflow-hidden ${darkMode === "dark"
            ? "bg-[#0f0f0f]/60 border-border-primary/40"
            : "bg-white/90 border-gray-200/70"
          }`}
      >
        <div className="h-20 bg-gradient-to-br from-violet-500/30 via-purple-500/20 to-blue-500/10" />
        <div className="flex justify-center -mt-10 mb-3">
          {user.avatar_url ? (
            <img
              src={user.avatar_url}
              alt={user.name}
              className="w-20 h-20 rounded-2xl ring-4 ring-offset-2 ring-accent/30 object-cover"
            />
          ) : (
            <div className="w-20 h-20 rounded-2xl ring-4 ring-offset-2 ring-accent/30 bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-3xl font-bold shadow-lg">
              {initial}
            </div>
          )}
        </div>
        <div className="px-6 pb-6 text-center">
          <h2 className="text-lg font-semibold text-primary leading-tight">
            {user.name || "—"}
          </h2>
          <p
            className={`mt-1 text-sm ${darkMode === "dark" ? "text-secondary" : "text-gray-500"
              }`}
          >
            {user.email}
          </p>
          <div
            className={`mt-5 rounded-xl border p-4 text-left space-y-3 ${darkMode === "dark"
                ? "border-border-primary/30 bg-white/[0.03]"
                : "border-gray-100 bg-gray-50/80"
              }`}
          >
            <ConfigRow label="用户名" value={user.name || "—"} />
            <ConfigRow label="邮箱" value={user.email || "—"} />
          </div>
        </div>
      </div>
    </div>
  );
};

const ConfigRow: React.FC<{ label: string; value: string }> = ({
  label,
  value,
}) => (
  <div className="flex items-center justify-between">
    <span className="text-xs text-secondary uppercase tracking-wide font-medium">
      {label}
    </span>
    <span className="text-sm text-primary font-medium truncate max-w-[60%]">
      {value}
    </span>
  </div>
);

// ── 智能体设置 ────────────────────────────────────────────────────────────────

const AgentSettingsSection: React.FC<{ userEmail?: string }> = ({
  userEmail,
}) => {
  const { darkMode } = useContext(appContext);
  const { config, updateConfig, resetToDefaults } = useSettingsStore();
  const [websiteInput, setWebsiteInput] = React.useState("");
  const [cachedWebsites, setCachedWebsites] = React.useState<string[]>(
    config.allowed_websites || []
  );
  const [allowedlistEnabled, setAllowedlistEnabled] = React.useState(
    Boolean(config.allowed_websites?.length)
  );
  const [modelLabel, setModelLabel] = React.useState<string>();

  React.useEffect(() => {
    if (!userEmail) return;
    settingsAPI
      .getSettings(userEmail)
      .then((settings) => {
        updateConfig(settings);
        setCachedWebsites(settings.allowed_websites || []);
        setAllowedlistEnabled(Boolean(settings.allowed_websites?.length));
      })
      .catch(() => { });
  }, [userEmail]);

  const handleUpdateConfig = async (changes: Partial<typeof config>) => {
    if (!userEmail) return;
    try {
      const updatedConfig = { ...config, ...changes };
      const res = await settingsAPI.updateSettings(userEmail, updatedConfig);
      updateConfig({
        model_configs: res.config.model_configs,
        model_name: res.config.model_name,
      });
    } catch {
      message.error("保存设置失败");
    }
  };

  const addWebsite = () => {
    if (websiteInput && !cachedWebsites.includes(websiteInput)) {
      const updated = [...cachedWebsites, websiteInput];
      setCachedWebsites(updated);
      handleUpdateConfig({ allowed_websites: updated });
      setWebsiteInput("");
    }
  };

  const removeWebsite = (site: string) => {
    const updated = cachedWebsites.filter((s) => s !== site);
    setCachedWebsites(updated);
    handleUpdateConfig({ allowed_websites: updated });
  };

  const handleYamlFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      handleUpdateConfig({ model_configs: content, model_name: modelLabel });
      message.success("YAML 配置导入成功");
    };
    reader.readAsText(file);
    return false;
  };

  const updateModelInConfig = ({
    value: modelName,
    label,
  }: {
    value: string;
    label: string;
  }) => {
    setModelLabel(label);
    handleUpdateConfig({
      model_configs: generateOpenAIModelConfig(modelName),
      model_name: label,
    });
    message.success("模型配置已更新");
  };

  const handleResetDefaults = () => {
    resetToDefaults();
    setCachedWebsites([]);
    if (userEmail) {
      settingsAPI
        .updateSettings(userEmail, useSettingsStore.getState().config)
        .catch(() => { });
    }
    message.success("已恢复默认设置");
  };

  return (
    <div className="space-y-6 px-1 pt-4">
      {/* 执行策略 */}
      <div>
        <h3 className="text-sm font-semibold text-primary mb-3">执行策略</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm">
              操作审批策略
              <Tooltip title="控制智能体执行操作前是否需要人工确认">
                <InfoCircleOutlined className="text-secondary" />
              </Tooltip>
            </span>
            <Select
              value={config.approval_policy}
              onChange={(value) => handleUpdateConfig({ approval_policy: value })}
              style={{ width: 200 }}
              options={[
                { value: "never", label: "从不需要审批" },
                { value: "auto-conservative", label: "AI 自动判断" },
                { value: "always", label: "始终需要审批" },
              ]}
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm">
              允许重新规划
              <Tooltip title="当计划不可行时，智能体自动重新制定计划">
                <InfoCircleOutlined className="text-secondary" />
              </Tooltip>
            </span>
            <Switch
              checked={config.allow_for_replans}
              checkedChildren="开"
              unCheckedChildren="关"
              onChange={(checked) =>
                handleUpdateConfig({ allow_for_replans: checked })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm">
              检索历史计划
              <Tooltip title="控制智能体是否检索历史任务的计划作为参考">
                <InfoCircleOutlined className="text-secondary" />
              </Tooltip>
            </span>
            <Select
              value={config.retrieve_relevant_plans}
              onChange={(value) =>
                handleUpdateConfig({ retrieve_relevant_plans: value })
              }
              style={{ width: 200 }}
              options={[
                { value: "never", label: "不检索" },
                { value: "hint", label: "作为提示" },
                { value: "reuse", label: "直接复用" },
              ]}
            />
          </div>
        </div>
      </div>

      <Divider className="!my-3" />

      {/* 网站访问控制 */}
      <div>
        <h3 className="text-sm font-semibold text-primary mb-3">
          网站访问控制
        </h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm">
              允许访问列表
              <Tooltip title="开启后，智能体只能访问列表中的网站">
                <InfoCircleOutlined className="text-secondary" />
              </Tooltip>
            </span>
            {cachedWebsites.length === 0 && (
              <Switch
                checked={allowedlistEnabled}
                checkedChildren="限制访问"
                unCheckedChildren="不限制"
                onChange={(checked) => {
                  setAllowedlistEnabled(checked);
                  if (!checked) {
                    setCachedWebsites([]);
                    handleUpdateConfig({ allowed_websites: [] });
                  }
                }}
              />
            )}
          </div>
          {(allowedlistEnabled || cachedWebsites.length > 0) && (
            <Space direction="vertical" style={{ width: "100%" }}>
              <div className="flex gap-2">
                <Input
                  placeholder="https://example.com"
                  value={websiteInput}
                  onChange={(e) => setWebsiteInput(e.target.value)}
                  onPressEnter={addWebsite}
                  className="flex-1"
                />
                <Button icon={<Plus size={16} />} onClick={addWebsite}>
                  添加
                </Button>
              </div>
              <div>
                {cachedWebsites.map((site, i) => (
                  <Tag
                    key={i}
                    closable
                    onClose={() => removeWebsite(site)}
                    style={{ margin: "0 8px 8px 0" }}
                  >
                    {site}
                  </Tag>
                ))}
              </div>
            </Space>
          )}
        </div>
      </div>

      <Divider className="!my-3" />

      {/* 模型配置 */}
      <div>
        <h3 className="text-sm font-semibold text-primary mb-3">模型配置</h3>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <div className="text-sm text-secondary mb-1">快速选择模型</div>
              <Select
                labelInValue
                style={{ width: "100%" }}
                options={MODEL_OPTIONS}
                onChange={updateModelInConfig}
                placeholder="选择模型套用配置模板"
              />
            </div>
            <Upload
              accept=".yaml,.yml"
              showUploadList={false}
              beforeUpload={handleYamlFileUpload}
            >
              <Button icon={<UploadOutlined />} className="mt-5">
                导入 YAML
              </Button>
            </Upload>
          </div>

          <div>
            <div className="flex items-center gap-2 text-sm text-secondary mb-1">
              高级配置（YAML）
              <Tooltip title="AutoGen ChatCompletionClient 格式，必须包含 orchestrator_client、coder_client、web_surfer_client、file_surfer_client">
                <InfoCircleOutlined />
              </Tooltip>
            </div>
            <MonacoEditor
              value={config.model_configs}
              onChange={(value) => handleUpdateConfig({ model_configs: value })}
              language="yaml"
              height="280px"
              options={{
                fontFamily: "monospace",
                minimap: { enabled: false },
                wordWrap: "on",
                scrollBeyondLastLine: false,
                theme: darkMode === "dark" ? "vs-dark" : "light",
              }}
            />
          </div>
        </div>
      </div>

      <Divider className="!my-3" />

      {/* 存储管理 */}
      <div>
        <h3 className="text-sm font-semibold text-primary mb-3">存储管理</h3>
        <div className="space-y-2">
          <div className="text-sm text-secondary">
            当前占用：{getStorageUsageString()}
          </div>
          <div className="flex gap-2">
            <Button
              size="small"
              onClick={() => {
                clearMessageCache();
                message.success("消息缓存已清除");
              }}
            >
              清除消息缓存
            </Button>
            <Button
              size="small"
              danger
              onClick={() =>
                Modal.confirm({
                  title: "清除所有 Dr.Sai 数据",
                  content:
                    "将清除所有设置、消息缓存等本地数据，操作不可撤销。",
                  onOk: () => {
                    clearDrSaiStorage();
                    message.success("所有数据已清除");
                    setTimeout(() => window.location.reload(), 1000);
                  },
                })
              }
            >
              清除所有数据
            </Button>
          </div>
        </div>
      </div>

      <div className="pt-2">
        <Button onClick={handleResetDefaults}>恢复默认设置</Button>
      </div>
    </div>
  );
};

// ── 主组件 ────────────────────────────────────────────────────────────────────

const Config: React.FC = () => {
  const { user: ctxUser } = useContext(appContext);
  const user: UserLike = ctxUser || {};
  const tabItems = [
    {
      key: "profile",
      label: "个人信息",
      children: <ProfileSection user={user} />,
    },
    // {
    //   key: "agent",
    //   label: "智能体设置",
    //   children: <AgentSettingsSection userEmail={user.email} />,
    // },
  ];

  return (
    <div className="h-full overflow-y-auto px-6 pt-6 pb-10">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-xl font-semibold text-primary mb-6">配置</h1>
        <Tabs tabPosition="left" items={tabItems} />
      </div>
    </div>
  );
};

export default Config;
