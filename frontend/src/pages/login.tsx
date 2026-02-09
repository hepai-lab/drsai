import React, { useState } from "react";
import { Tabs, Form, Input, Button, message, Card } from "antd";
import { UserOutlined, LockOutlined } from "@ant-design/icons";
import { navigate } from "gatsby";
import { appContext } from "../hooks/provider";
import { authAPI, agentWorkerAPI } from "../components/views/api";

const { TabPane } = Tabs;

// 登录页面专用的 Tabs 样式
const loginTabsStyle = `
    .login-page-tabs .ant-tabs-tab-btn {
        color: #fff !important;
        transition: none !important;
    }
    .login-page-tabs .ant-tabs-tab.ant-tabs-tab-active .ant-tabs-tab-btn {
        color: #fff !important;
        font-weight: 500;
    }
    .login-page-tabs .ant-tabs-tab:hover .ant-tabs-tab-btn {
        color: rgba(255, 255, 255, 0.8) !important;
    }
    .login-page-tabs .ant-tabs-ink-bar {
        background-color: #fff !important;
        transition: none !important;
    }
    .login-page-tabs .ant-tabs-nav::before {
        border-color: rgba(255, 255, 255, 0.2) !important;
    }
    .login-page-button {
        padding: 15px 30px !important;
        font-size: 1.1rem !important;
        background: rgba(255,255,255,0.1) !important;
        color: #fff !important;
        border: none !important;
        border-radius: 25px !important;
        cursor: pointer !important;
        transition: all 0.3s ease !important;
        backdrop-filter: blur(5px) !important;
        box-shadow: 0 4px 15px rgba(0,0,0,0.2) !important;
    }
    .login-page-button:hover {
        background: rgba(255,255,255,0.2) !important;
        transform: translateY(-2px) !important;
        box-shadow: 0 6px 20px rgba(0,0,0,0.3) !important;
    }
`;

const backgroundStyle: React.CSSProperties = {
    minHeight: "100vh",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    background: `linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)),
    url('https://images.unsplash.com/photo-1497864149936-d3163f0c0f4b?ixlib=rb-1.2.1&auto=format&fit=crop&w=1950&q=80')`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    padding: "20px",
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
    border: "1px solid rgba(255,255,255,0.2)",
};

const h2Style: React.CSSProperties = {
    color: "#fff",
    fontSize: "2.5rem",
    marginBottom: "1.5rem",
    textShadow: "2px 2px 4px rgba(0,0,0,0.5)",
};

const cardStyle: React.CSSProperties = {
    width: 400,
    background: "rgba(255,255,255,0.1)",
    borderRadius: 15,
    backdropFilter: "blur(10px)",
    boxShadow: "0 8px 32px 0 rgba(31, 38, 135, 0.37)",
    border: "1px solid rgba(255,255,255,0.2)",
};

const LoginPage: React.FC = () => {
    const { setUser } = React.useContext(appContext);
    const [loginLoading, setLoginLoading] = useState(false);
    const [registerLoading, setRegisterLoading] = useState(false);
    const [activeTab, setActiveTab] = useState("login");
    const [loginForm] = Form.useForm();

    // 路由保护由 RouteGuard 组件统一处理
    // 如果已经登录，RouteGuard 会自动重定向到主页

    const handleLogin = async (values: any) => {
        setLoginLoading(true);
        try {
            const response = await authAPI.login(values.username, values.password);
            if (response.status) {
                // 保存用户信息到本地存储
                localStorage.setItem("token", `local_${Date.now()}`);
                localStorage.setItem("username", values.username);
                localStorage.setItem("user_email", values.username);
                localStorage.setItem("user_name", values.username);

                // 更新用户状态
                setUser({
                    name: values.username,
                    email: values.username,
                    username: values.username,
                });

                // 清除之前的agent选择，确保新用户登录后使用默认agent
                localStorage.removeItem("drsai-mode-config");
                // 登录成功后立即初始化用户默认智能体列表（在所有接口之前）
                try {
                    await agentWorkerAPI.getUserDefaultAgents(values.username);
                } catch (error) {
                    console.error("Failed to initialize user default agents:", error);
                    // 即使失败也继续，避免阻塞用户登录
                }

                message.success("登录成功！");
                window.location.href = "/";
            }
        } catch (error: any) {
            message.error(error.message || "登录失败，请重试");
        } finally {
            setLoginLoading(false);
        }
    };

    const handleRegister = async (values: any) => {
        setRegisterLoading(true);
        try {
            if (values.password !== values.confirmPassword) {
                message.error("两次输入的密码不一致");
                return;
            }

            const response = await authAPI.register(values.username, values.password);

            if (response.status) {
                message.success("注册成功！请使用您的账号密码登录");
                // 切换到登录标签页并预填充用户名
                setActiveTab("login");
                loginForm.setFieldsValue({ username: values.username });
            }
        } catch (error: any) {
            message.error(error.message || "注册失败，请重试");
        } finally {
            setRegisterLoading(false);
        }
    };

    return (
        <div style={backgroundStyle}>
            <style>{loginTabsStyle}</style>
            <div style={logoContainerStyle}>
                IHEP计算中心
            </div>

            <div style={containerStyle}>
                <h2 style={h2Style}>
                    欢迎探索 Dr. Sai 智能体
                </h2>
                <Card style={cardStyle}>
                    <Tabs activeKey={activeTab} onChange={setActiveTab} centered className="login-page-tabs">
                        <TabPane tab="登录" key="login">
                            <Form
                                form={loginForm}
                                name="login"
                                onFinish={handleLogin}
                                autoComplete="off"
                                layout="vertical"
                            >
                                <Form.Item
                                    name="username"
                                    rules={[{ required: true, message: "请输入用户名!" }]}
                                >
                                    <Input
                                        prefix={<UserOutlined />}
                                        placeholder="用户名"
                                        size="large"
                                    />
                                </Form.Item>

                                <Form.Item
                                    name="password"
                                    rules={[{ required: true, message: "请输入密码!" }]}
                                >
                                    <Input.Password
                                        prefix={<LockOutlined />}
                                        placeholder="密码"
                                        size="large"
                                    />
                                </Form.Item>

                                <Form.Item>
                                    <Button
                                        htmlType="submit"
                                        size="large"
                                        block
                                        loading={loginLoading}
                                        className="login-page-button"
                                    >
                                        登录
                                    </Button>
                                </Form.Item>
                            </Form>
                        </TabPane>

                        <TabPane tab="注册" key="register">
                            <Form
                                name="register"
                                onFinish={handleRegister}
                                autoComplete="off"
                                layout="vertical"
                            >
                                <Form.Item
                                    name="username"
                                    rules={[
                                        { required: true, message: "请输入用户名!" },
                                        { min: 3, message: "用户名至少3个字符!" },
                                        {
                                            validator: (_, value) => {
                                                if (!value) {
                                                    return Promise.resolve();
                                                }
                                                // 检查是否是纯数字
                                                if (/^\d+$/.test(value)) {
                                                    return Promise.reject(new Error("用户名不能是纯数字!"));
                                                }
                                                return Promise.resolve();
                                            },
                                        },
                                    ]}
                                >
                                    <Input
                                        prefix={<UserOutlined />}
                                        placeholder="用户名"
                                        size="large"
                                    />
                                </Form.Item>

                                <Form.Item
                                    name="password"
                                    rules={[
                                        { required: true, message: "请输入密码!" },
                                        { min: 6, message: "密码至少6个字符!" }
                                    ]}
                                >
                                    <Input.Password
                                        prefix={<LockOutlined />}
                                        placeholder="密码"
                                        size="large"
                                    />
                                </Form.Item>

                                <Form.Item
                                    name="confirmPassword"
                                    rules={[
                                        { required: true, message: "请确认密码!" },
                                        ({ getFieldValue }) => ({
                                            validator(_, value) {
                                                if (!value || getFieldValue('password') === value) {
                                                    return Promise.resolve();
                                                }
                                                return Promise.reject(new Error('两次输入的密码不一致!'));
                                            },
                                        }),
                                    ]}
                                >
                                    <Input.Password
                                        prefix={<LockOutlined />}
                                        placeholder="确认密码"
                                        size="large"
                                    />
                                </Form.Item>

                                <Form.Item>
                                    <Button
                                        htmlType="submit"
                                        size="large"
                                        block
                                        loading={registerLoading}
                                        className="login-page-button"
                                    >
                                        注册
                                    </Button>
                                </Form.Item>
                            </Form>
                        </TabPane>
                    </Tabs>
                </Card>
            </div>
        </div>
    );
};

export default LoginPage;