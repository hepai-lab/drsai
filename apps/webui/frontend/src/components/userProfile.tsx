import React, { useEffect, useState } from "react";
import { Modal, Tag, Divider } from "antd";
import { Mail, Shield, Users, Building2, Loader2 } from "lucide-react";
import { useLang } from "../i18n/useLang";
import { userAPI } from "./views/api";

type UserProfileModalProps = {
  isVisible: boolean;
  onClose: () => void;
  user: { name?: string; email?: string };
};

const UserProfileModal: React.FC<UserProfileModalProps> = ({
  isVisible,
  onClose,
  user,
}) => {
  const { t } = useLang();
  const [cooperInfo, setCooperInfo] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isVisible || !user?.email) return;
    let cancelled = false;
    setLoading(true);
    setCooperInfo("");
    setDisplayName("");
    userAPI
      .getCooperInfo()
      .then((info) => {
        if (!cancelled) {
          setCooperInfo(info.cooper_info);
          setDisplayName(info.display_name);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCooperInfo("");
          setDisplayName("");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isVisible, user?.email]);

  const showName = displayName || user?.name || user?.email || "?";
  const initial = showName.charAt(0).toUpperCase();

  return (
    <Modal
      open={isVisible}
      onCancel={onClose}
      footer={null}
      title={null}
      centered
      destroyOnClose
      width={400}
      className="[&_.ant-modal-content]:!rounded-2xl [&_.ant-modal-content]:!overflow-hidden [&_.ant-modal-content]:!p-0"
    >
      {/* 顶部装饰条 */}
      <div className="h-20 bg-gradient-to-br from-violet-500/30 via-purple-500/20 to-blue-500/10" />

      {/* 头像 */}
      <div className="flex justify-center -mt-10 mb-4">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 text-white flex items-center justify-center text-2xl font-bold shadow-lg ring-4 ring-white dark:ring-[#0f0f0f]">
          {initial}
        </div>
      </div>

      {/* 用户信息 */}
      <div className="px-6 pb-6 text-center">
        <div className="text-lg font-bold text-primary mb-1">
          {showName}
        </div>
        <div className="text-sm text-secondary mb-4 flex items-center justify-center gap-1.5">
          <Mail className="w-3.5 h-3.5" />
          {user?.email}
        </div>

        <Divider className="!my-3" />

        {/* 合作组信息 */}
        <div className="rounded-xl bg-tertiary/10 border border-border-primary/20 p-4">
          <div className="flex items-center justify-center gap-2 mb-2 text-secondary">
            <Building2 className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-wide">
              {t("userProfile.cooperGroup")}
            </span>
          </div>
          {loading ? (
            <div className="flex items-center justify-center gap-2 text-secondary">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">加载中...</span>
            </div>
          ) : cooperInfo ? (
            <Tag color="purple" className="!text-sm !px-3 !py-1 !rounded-lg !border-0">
              <span className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />
                {cooperInfo}
              </span>
            </Tag>
          ) : (
            <span className="text-sm text-tertiary">未关联合作组</span>
          )}
        </div>

        {/* 角色信息 */}
        <div className="mt-3 rounded-xl bg-tertiary/10 border border-border-primary/20 p-4">
          <div className="flex items-center justify-center gap-2 text-secondary">
            <Shield className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-wide">
              {t("userProfile.role")}
            </span>
          </div>
          <div className="mt-2">
            <Tag color="blue" className="!rounded-lg !border-0">
              普通用户
            </Tag>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default UserProfileModal;