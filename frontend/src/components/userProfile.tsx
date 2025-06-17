import React from "react";
import { Modal } from "antd";

type UserProfileModalProps = {
  isVisible: boolean;
  onClose: () => void;
  user: { name?: string; email?: string };
};

const UserProfileModal: React.FC<UserProfileModalProps> = ({ isVisible, onClose, user }) => {

  return (
    <Modal
      open={isVisible}
      onCancel={onClose}
      footer={null}
      title="用户信息"
      centered
      destroyOnClose
    >
      <div style={{ textAlign: "center" }}>
        <div style={{ fontWeight: "bold", fontSize: 18, marginBottom: 8 }}>
          {user?.name || user?.email}
        </div>
        <div style={{ color: "#888", marginBottom: 24 }}>{user?.email}</div>
        <button
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
            localStorage.removeItem("token");
            localStorage.removeItem("username");
            localStorage.removeItem("user_email");
            localStorage.removeItem("user_name");
            window.location.href = "/umt/logout";
          }}
        >
          退出登录
        </button>
      </div>
    </Modal>
  );
};

export default UserProfileModal;