import React from "react";
import { Modal } from "antd";
import { useLang } from "../i18n/useLang";

type UserProfileModalProps = {
  isVisible: boolean;
  onClose: () => void;
  user: { name?: string; email?: string };
};

const UserProfileModal: React.FC<UserProfileModalProps> = ({ isVisible, onClose, user }) => {
  const { t } = useLang();

  return (
    <Modal
      open={isVisible}
      onCancel={onClose}
      footer={null}
      title={t("userProfile.title")}
      centered
      destroyOnClose
    >
      <div style={{ textAlign: "center" }}>
        <div style={{ fontWeight: "bold", fontSize: 18, marginBottom: 8 }}>
          {user?.name || user?.email}
        </div>
        <div style={{ color: "#888", marginBottom: 24 }}>{user?.email}</div>
        {/* <button
          style={{
            width: "100%",
            padding: "8px 0",
            background: "#f5222d",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            marginBottom: 8,
          }}
          onClick={() => {
            clearAuthSession();
            window.location.href = "/umt/logout";
          }}
        >
          退出登录
        </button> */}
      </div>
    </Modal>
  );
};

export default UserProfileModal;