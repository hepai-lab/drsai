import React from "react";

const backgroundStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  margin: 0,
  background: `linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)),
    url('https://images.unsplash.com/photo-1497864149936-d3163f0c0f4b?ixlib=rb-1.2.1&auto=format&fit=crop&w=1950&q=80')`,
  backgroundSize: "cover",
  backgroundPosition: "center",
  fontFamily: "Arial, sans-serif",
  position: "relative",
};

const logoContainerStyle: React.CSSProperties = {
  position: "fixed",
  top: 20,
  left: 20,
  zIndex: 1000,
  color: "white",
  fontSize: 16,
  lineHeight: 1.2,
};

const containerStyle: React.CSSProperties = {
  textAlign: "center",
  padding: "2rem",
  background: "rgba(255,255,255,0.1)",
  borderRadius: 15,
  backdropFilter: "blur(10px)",
  boxShadow: "0 8px 32px 0 rgba(31, 38, 135, 0.37)",
};

const h1Style: React.CSSProperties = {
  color: "#fff",
  fontSize: "2.5rem",
  marginBottom: "1.5rem",
  textShadow: "2px 2px 4px rgba(0,0,0,0.5)",
};

const h2Style: React.CSSProperties = {
  color: "#fff",
  fontSize: "1.5rem",
  marginBottom: "1.5rem",
  textShadow: "2px 2px 4px rgba(0,0,0,0.5)",
};

const buttonStyle: React.CSSProperties = {
  padding: "15px 30px",
  fontSize: "1.1rem",
  background: "rgba(255,255,255,0.1)",
  color: "#fff",
  border: "none",
  borderRadius: 25,
  cursor: "pointer",
  transition: "all 0.3s ease",
  backdropFilter: "blur(5px)",
  boxShadow: "0 4px 15px rgba(0,0,0,0.2)",
};

const buttonHoverStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.2)",
  transform: "translateY(-2px)",
  boxShadow: "0 6px 20px rgba(0,0,0,0.3)",
};

const modalOverlayStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  width: "100vw",
  height: "100vh",
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  zIndex: 2000,
};

const modalStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 10,
  padding: "2rem",
  minWidth: 320,
  boxShadow: "0 8px 32px 0 rgba(31, 38, 135, 0.37)",
  position: "relative",
  textAlign: "center",
};

const closeBtnStyle: React.CSSProperties = {
  position: "absolute",
  top: 10,
  right: 15,
  background: "none",
  border: "none",
  fontSize: 22,
  cursor: "pointer",
  color: "#888",
};

export const SSOLogin: React.FC = () => {
  const [hover, setHover] = React.useState(false);
  const [showModal, setShowModal] = React.useState(false);
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loginError, setLoginError] = React.useState("");

  const handleLogin = () => {
    window.location.href = "/umt/login";
  };

  const handleLocalLogin = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: 替换为实际本地登录逻辑
    if (username === "" || password === "") {
      setLoginError("请输入账号和密码");
    } else {
      setLoginError("");
      // 跳转到 /auth?username=xxx
      console.log(`登录用户: ${username}`);
      window.location.href = `/auth?username=${encodeURIComponent(username)}&token=local`;
      setShowModal(false);

    }
  };

  return (
    <div style={backgroundStyle}>
      <div style={logoContainerStyle}>
          IHEP计算中心&实验物理中心
      </div>
      <div style={containerStyle}>
        <h2
          style={{ ...h2Style, cursor: "pointer" }}
          onClick={() => setShowModal(true)}
          title="点击使用本地用户登录"
        >
          欢迎探索 Dr. Sai 智能体
        </h2>
        <button
          style={hover ? { ...buttonStyle, ...buttonHoverStyle } : buttonStyle}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onClick={handleLogin}
        >
          使用高能所统一认证（IHEP-SSO）登录
        </button>
      </div>
      {showModal && (
        <div style={modalOverlayStyle} onClick={() => setShowModal(false)}>
          <div
            style={modalStyle}
            onClick={e => e.stopPropagation()}
          >
            <button style={closeBtnStyle} onClick={() => setShowModal(false)} title="关闭">×</button>
            <h3 style={{ marginBottom: 20 }}>本地用户登录</h3>
            <form onSubmit={handleLocalLogin}>
              <div style={{ marginBottom: 15 }}>
                <input
                  type="text"
                  placeholder="账号"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  style={{
                    width: "90%",
                    padding: "8px",
                    borderRadius: 5,
                    border: "1px solid #ccc",
                    fontSize: 16,
                  }}
                  autoFocus
                />
              </div>
              <div style={{ marginBottom: 15 }}>
                <input
                  type="password"
                  placeholder="密码"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  style={{
                    width: "90%",
                    padding: "8px",
                    borderRadius: 5,
                    border: "1px solid #ccc",
                    fontSize: 16,
                  }}
                />
              </div>
              {loginError && (
                <div style={{ color: "red", marginBottom: 10 }}>{loginError}</div>
              )}
              <button
                type="submit"
                style={{
                  ...buttonStyle,
                  color: "#333",
                  background: "#f0f0f0",
                  boxShadow: "none",
                  marginTop: 5,
                }}
              >
                登录
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SSOLogin;
