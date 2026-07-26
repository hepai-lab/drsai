import {
  ArrowRight,
  Check,
  Copy,
  Download,
  Github,
  Moon,
  Sun,
  Terminal,
} from "lucide-react";
import React, { useContext, useEffect, useRef, useState } from "react";
import openDrSaiLogo from "../assets/logo.svg";
import { appContext } from "../hooks/provider";

const WINDOWS_DOWNLOAD_URL =
  process.env.GATSBY_WINDOWS_DOWNLOAD_URL ||
  "https://download-opendrsai.ihep.ac.cn/releases/v1.5.2/windows/OpenDrSai-Windows-Installer-x64.msi";
const ANDROID_DOWNLOAD_URL =
  process.env.GATSBY_ANDROID_DOWNLOAD_URL ||
  "https://download-opendrsai.ihep.ac.cn/releases/v1.5.1/android/OpenDrSai-Android-v1.5.1.apk";
const TUI_COMMAND = "pip install -U drsai";
type ClientTab = "windows" | "android" | "terminal" | "macos";

const WelcomePage = () => {
  const { darkMode, setDarkMode, lang, setLang } = useContext(appContext);
  const [copied, setCopied] = useState(false);
  const [activeClient, setActiveClient] = useState<ClientTab | null>(null);
  const clientDetailsRef = useRef<HTMLDivElement>(null);
  const isZh = lang === "zh";

  useEffect(() => {
    document.documentElement.className =
      darkMode === "dark" ? "dark bg-primary" : "light bg-primary";
  }, [darkMode]);

  useEffect(() => {
    if (!activeClient || !clientDetailsRef.current) return;
    clientDetailsRef.current.focus({ preventScroll: true });
    clientDetailsRef.current.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [activeClient]);

  const copyTuiCommand = async () => {
    try {
      await navigator.clipboard.writeText(TUI_COMMAND);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const toggleClient = (client: ClientTab) => {
    setActiveClient((current) => (current === client ? null : client));
  };

  const openClient = (client: ClientTab) => {
    if (activeClient === client && clientDetailsRef.current) {
      clientDetailsRef.current.focus({ preventScroll: true });
      clientDetailsRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      return;
    }
    setActiveClient(client);
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f8f8fb] font-agent text-slate-950 transition-colors dark:bg-[#0d1016] dark:text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[32rem] bg-[radial-gradient(ellipse_at_top,rgba(124,58,237,0.13),transparent_66%)] dark:bg-[radial-gradient(ellipse_at_top,rgba(124,58,237,0.14),transparent_66%)]" />

      <header className="relative z-10 mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-8">
        <a
          href="/welcome"
          className="flex items-center gap-2.5 text-slate-950 no-underline dark:text-white"
          aria-label="OpenDrSai"
        >
          <span className="h-9 w-9 overflow-hidden rounded-xl shadow-sm ring-1 ring-black/5 dark:ring-white/10">
            <img
              src={openDrSaiLogo}
              alt=""
              className="h-full w-full object-cover"
            />
          </span>
          <span className="flex flex-col">
            <span className="text-base font-extrabold leading-tight tracking-[-0.03em]">
              OpenDrSai
            </span>
            <span className="mt-0.5 hidden text-[10px] font-medium leading-none tracking-[0.08em] text-slate-500 min-[390px]:block dark:text-slate-400">
              「开源赛博士」智能体工作台
            </span>
          </span>
        </a>

        <div className="flex items-center gap-1">
          <a
            href="https://docs-drsai.ihep.ac.cn/"
            target="_blank"
            rel="noreferrer"
            className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 no-underline hover:text-violet-700 sm:inline-flex dark:text-slate-400 dark:hover:text-violet-300"
          >
            {isZh ? "文档" : "Docs"}
          </a>
          <button
            type="button"
            onClick={() => setLang(isZh ? "en" : "zh")}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:text-violet-700 dark:text-slate-400 dark:hover:text-violet-300"
            aria-label={isZh ? "Switch to English" : "切换为中文"}
          >
            {isZh ? "EN" : "中"}
          </button>
          <button
            type="button"
            onClick={() => setDarkMode(darkMode === "dark" ? "light" : "dark")}
            className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:text-violet-700 dark:text-slate-400 dark:hover:text-violet-300"
            aria-label={isZh ? "切换主题" : "Toggle theme"}
          >
            {darkMode === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>
          <a
            href="https://github.com/hepai-lab/drsai"
            target="_blank"
            rel="noreferrer"
            className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 no-underline hover:text-violet-700 dark:text-slate-400 dark:hover:text-violet-300"
            aria-label="GitHub"
            title="GitHub"
          >
            <Github className="h-[18px] w-[18px]" />
          </a>
        </div>
      </header>

      <section className="relative z-10 mx-auto flex max-w-5xl flex-col items-center px-4 pb-10 pt-12 text-center sm:px-8 sm:pb-20 sm:pt-28">
        <p className="mb-5 text-xs font-extrabold uppercase tracking-[0.22em] text-violet-600 dark:text-violet-400">
          {isZh ? "您的智能体，随处可用" : "Your agent, everywhere"}
        </p>
        <h1 className="max-w-4xl text-3xl font-extrabold leading-[1.1] tracking-[-0.045em] min-[390px]:text-4xl sm:text-6xl sm:tracking-[-0.055em]">
          {isZh ? "让智能体，随处与您协作" : "Your agent, ready to collaborate anywhere"}
        </h1>
        <p className="mt-5 max-w-2xl text-sm font-medium leading-6 text-slate-500 sm:mt-6 sm:text-lg sm:leading-7 dark:text-slate-400">
          {isZh
            ? "在浏览器中直接对话，或下载适合你的客户端。会话与工作状态始终保持连贯。"
            : "Chat in the browser or choose the client that fits your workflow. Your sessions stay connected."}
        </p>

        <div className="mt-7 flex w-full max-w-md flex-col gap-3 sm:mt-8 sm:flex-row sm:justify-center">
          <a
            href="/login"
            className="group inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-5 py-3 text-sm font-extrabold text-white no-underline shadow-lg shadow-violet-500/20 transition hover:-translate-y-0.5"
          >
            {isZh ? "直接开始对话" : "Start chatting"}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </a>
          <div className="inline-flex flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white/70 px-5 py-2.5 text-sm font-extrabold text-slate-700 no-underline transition hover:border-violet-300 hover:text-violet-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:border-violet-400/40">
            <button
              type="button"
              onClick={() => openClient("windows")}
              className="inline-flex items-center gap-2 bg-transparent font-extrabold"
            >
              <Download className="h-4 w-4" />
              {isZh ? "下载客户端" : "Get the apps"}
            </button>
            <span
              className="flex items-center gap-1"
              aria-label={isZh ? "选择客户端" : "Choose a client"}
            >
              <button
                type="button"
                onClick={() => toggleClient("windows")}
                className="rounded-md p-0.5 transition hover:bg-blue-50 dark:hover:bg-white/10"
                aria-label="Windows"
              >
                <span className="block scale-100 sm:scale-75">
                  <WindowsLogo />
                </span>
              </button>
              <button
                type="button"
                onClick={() => toggleClient("macos")}
                className="rounded-md p-0.5 transition hover:bg-slate-100 dark:hover:bg-white/10"
                aria-label="macOS"
              >
                <span className="block scale-100 sm:scale-75">
                  <AppleLogo />
                </span>
              </button>
              <button
                type="button"
                onClick={() => toggleClient("android")}
                className="rounded-md p-0.5 transition hover:bg-emerald-50 dark:hover:bg-white/10"
                aria-label="Android"
              >
                <span className="block scale-100 sm:scale-75">
                  <AndroidLogo />
                </span>
              </button>
              <button
                type="button"
                onClick={() => toggleClient("terminal")}
                className="rounded-md p-1 transition hover:bg-slate-100 dark:hover:bg-white/10"
                aria-label="Terminal UI"
              >
                <Terminal className="h-5 w-5 text-slate-700 sm:h-3.5 sm:w-3.5 dark:text-slate-200" />
              </button>
            </span>
          </div>
        </div>
      </section>

      <section id="clients" className="relative z-10 mx-auto max-w-6xl px-4 sm:px-8">
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 shadow-[0_18px_60px_-36px_rgba(76,29,149,0.35)] backdrop-blur dark:border-white/10 dark:bg-white/[0.035]">
          <div className="flex snap-x snap-mandatory overflow-x-auto sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-5">
            <ClientItem
              icon={<WebBrowserLogo />}
              title="WebUI"
              detail={isZh ? "浏览器直接使用" : "Use in your browser"}
              action={isZh ? "开始对话" : "Open"}
              href="/login"
              orderClass="order-2 sm:order-1"
            />
            <ClientItem
              icon={<WindowsLogo />}
              title="Windows"
              detail={isZh ? "连接本地工作区" : "Connect local workspaces"}
              action={isZh ? "查看" : "View"}
              active={activeClient === "windows"}
              onClick={() => toggleClient("windows")}
              orderClass="order-3 sm:order-2"
            />
            <ClientItem
              icon={<AndroidLogo />}
              title="Android"
              detail={isZh ? "移动处理与查看进度" : "Work and follow progress"}
              action={isZh ? "查看" : "View"}
              active={activeClient === "android"}
              onClick={() => toggleClient("android")}
              orderClass="order-1 border-l-0 sm:order-3 sm:border-l"
            />
            <button
              type="button"
              onClick={() => toggleClient("terminal")}
              className={`group order-4 flex min-h-24 min-w-[165px] snap-start items-center gap-3 border-l border-slate-100 p-4 text-left transition first:border-l-0 sm:min-h-36 sm:min-w-0 sm:gap-4 sm:border-l sm:border-t-0 sm:p-5 lg:border-l dark:border-white/5 ${
                activeClient === "terminal"
                  ? "bg-violet-50/80 dark:bg-violet-500/10"
                  : "bg-transparent hover:bg-violet-50/60 dark:hover:bg-violet-500/[0.06]"
              }`}
            >
              <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-slate-900 text-white dark:bg-white/10">
                <Terminal className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-extrabold">Terminal UI</span>
                <span className="mt-1 block truncate font-agent-mono text-[11px] text-slate-400">
                  {TUI_COMMAND}
                </span>
              </span>
              <span className="hidden text-xs font-extrabold text-violet-700 sm:inline dark:text-violet-300">
                {isZh ? "查看" : "View"}
              </span>
            </button>
            <button
              type="button"
              onClick={() => toggleClient("macos")}
              className={`order-5 flex min-h-24 min-w-[165px] snap-start items-center gap-3 border-l border-slate-100 p-4 text-left text-slate-950 transition sm:min-h-36 sm:min-w-0 sm:gap-4 sm:border-l sm:border-t-0 sm:p-5 dark:border-white/5 dark:text-white ${
                activeClient === "macos"
                  ? "bg-violet-50/80 dark:bg-violet-500/10"
                  : "bg-transparent hover:bg-violet-50/60 dark:hover:bg-violet-500/[0.06]"
              }`}
            >
              <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-slate-100 dark:bg-white/10">
                <AppleLogo />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-extrabold">macOS</span>
                <span className="mt-1 block text-xs font-medium text-slate-400">
                  Coming soon
                </span>
              </span>
              <span className="hidden text-xs font-extrabold text-violet-700 sm:inline dark:text-violet-300">
                {isZh ? "查看" : "View"}
              </span>
            </button>
          </div>
          {activeClient && (
            <div ref={clientDetailsRef} tabIndex={-1} className="outline-none">
              <ClientDetails
                active={activeClient}
                isZh={isZh}
                copied={copied}
                onCopy={copyTuiCommand}
              />
            </div>
          )}
        </div>
      </section>

      <footer className="relative z-10 mx-auto mt-20 flex max-w-6xl items-center justify-center border-t border-slate-200/70 px-5 py-6 text-xs font-semibold text-slate-400 dark:border-white/5 sm:px-8">
        © {new Date().getFullYear()} OpenDrSai · HepAI · HEP CAS
      </footer>
    </main>
  );
};

interface ClientItemProps {
  icon: React.ReactNode;
  title: string;
  detail: string;
  action: string;
  href?: string;
  active?: boolean;
  onClick?: () => void;
  orderClass?: string;
}

const WebBrowserLogo = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5"
    aria-hidden="true"
  >
    <path
      fill="#EA4335"
      d="M12 2a10 10 0 0 1 8.66 5H12a5 5 0 0 0-4.33 2.5L4.78 4.5A9.96 9.96 0 0 1 12 2Z"
    />
    <path
      fill="#FBBC05"
      d="M20.66 7A10 10 0 0 1 12 22l4.33-7.5A5 5 0 0 0 12 7h8.66Z"
    />
    <path
      fill="#34A853"
      d="M12 22A10 10 0 0 1 4.78 4.5l4.33 7.5A5 5 0 0 0 16.33 14.5L12 22Z"
    />
    <circle cx="12" cy="12" r="4.1" fill="#4285F4" />
    <circle cx="12" cy="12" r="3.1" fill="#E8F0FE" opacity=".22" />
  </svg>
);

const WindowsLogo = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5"
    fill="#0078D4"
    aria-hidden="true"
  >
    <path d="M2.5 4.8 10.7 3.7v7.5H2.5V4.8Zm9.4-1.3 9.6-1.3v9h-9.6V3.5ZM2.5 12.4h8.2v7.5l-8.2-1.1v-6.4Zm9.4 0h9.6v9l-9.6-1.3v-7.7Z" />
  </svg>
);

const AndroidLogo = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5"
    fill="#3DDC84"
    aria-hidden="true"
  >
    <path d="m7.2 6.5-1.5-2.2a.7.7 0 0 1 1.1-.8l1.6 2.3A8.1 8.1 0 0 1 12 5c1.3 0 2.5.3 3.6.8l1.6-2.3a.7.7 0 0 1 1.1.8l-1.5 2.2A6.5 6.5 0 0 1 19.5 12h-15a6.5 6.5 0 0 1 2.7-5.5ZM8.5 9.4a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Zm7 0a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8ZM4.5 13h15v5.5a2 2 0 0 1-2 2H17V23h-2v-2.5H9V23H7v-2.5h-.5a2 2 0 0 1-2-2V13ZM2 13.5a1 1 0 0 1 2 0v5a1 1 0 0 1-2 0v-5Zm18 0a1 1 0 0 1 2 0v5a1 1 0 0 1-2 0v-5Z" />
  </svg>
);

const AppleLogo = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5 fill-slate-950 dark:fill-white"
    aria-hidden="true"
  >
    <path d="M17.1 12.7c0-2.6 2.1-3.9 2.2-4-1.2-1.8-3.2-2-3.9-2-1.7-.2-3.2 1-4.1 1-.9 0-2.2-1-3.6-.9-1.8 0-3.5 1.1-4.5 2.7-1.9 3.3-.5 8.2 1.4 10.9.9 1.3 2 2.8 3.5 2.7 1.4-.1 1.9-.9 3.6-.9s2.1.9 3.6.9c1.5 0 2.4-1.3 3.3-2.7 1.1-1.5 1.5-3 1.5-3.1-.1 0-3-.9-3-4.6ZM14.3 5c.8-1 1.4-2.4 1.2-3.8-1.2.1-2.7.8-3.6 1.8-.8.9-1.5 2.3-1.3 3.7 1.4.1 2.8-.7 3.7-1.7Z" />
  </svg>
);

const ClientItem = ({
  icon,
  title,
  detail,
  action,
  href,
  active = false,
  onClick,
  orderClass = "",
}: ClientItemProps) => {
  const content = (
    <>
    <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-slate-100 dark:bg-white/10">
      {icon}
    </span>
    <span className="min-w-0 flex-1">
      <span className="block font-extrabold">{title}</span>
      <span className="mt-1 block text-xs font-medium text-slate-400">
        {detail}
      </span>
    </span>
    <span className="hidden flex-none text-xs font-extrabold text-violet-700 sm:inline dark:text-violet-300">
      {action}
    </span>
    </>
  );
  const className = `group ${orderClass} flex min-h-24 min-w-[165px] snap-start items-center gap-3 border-l border-slate-100 p-4 text-left text-slate-950 no-underline transition first:border-l-0 sm:min-h-36 sm:min-w-0 sm:gap-4 sm:border-l sm:border-t-0 sm:p-5 sm:first:border-l-0 lg:first:border-l-0 dark:border-white/5 dark:text-white ${
    active
      ? "bg-violet-50/80 dark:bg-violet-500/10"
      : "bg-transparent hover:bg-violet-50/60 dark:hover:bg-violet-500/[0.06]"
  }`;

  return href ? (
    <a href={href} className={className}>
      {content}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
};

interface ClientDetailsProps {
  active: ClientTab;
  isZh: boolean;
  copied: boolean;
  onCopy: () => void;
}

const ClientDetails = ({
  active,
  isZh,
  copied,
  onCopy,
}: ClientDetailsProps) => {
  const releases = {
    windows: {
      icon: <WindowsLogo />,
      title: "OpenDrSai for Windows",
      version: "v1.5.2",
      file: "OpenDrSai-Windows-Installer-x64.msi",
      size: "632 KB",
      sha256:
        "4dc7618f26c05cca4d467ec27a653aa9ac6d461585a0053f43bbd97499734853",
      programFile: "OpenDrSai-Windows-v1.5.2-x64.zip",
      programSize: "223 MB",
      href: WINDOWS_DOWNLOAD_URL,
    },
    android: {
      icon: <AndroidLogo />,
      title: "OpenDrSai for Android",
      version: "v1.5.1",
      file: "OpenDrSai-Android-v1.5.1.apk",
      size: "2.89 MB",
      sha256:
        "5ad72a12e6a9abb18bba35510bbabd9547dfc077839ff172fd508e98099a117b",
      href: ANDROID_DOWNLOAD_URL,
    },
  };

  if (active === "terminal") {
    return (
      <div className="border-t border-slate-200/80 p-6 dark:border-white/10 sm:p-8">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-900 text-white dark:bg-white/10">
                <Terminal className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-extrabold">OpenDrSai Terminal UI</h2>
                <p className="mt-1 text-xs font-medium text-slate-400">
                  Python · pip
                </p>
              </div>
            </div>
            <code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-agent-mono text-sm text-slate-100">
              {TUI_COMMAND}
            </code>
          </div>
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-extrabold text-white sm:w-auto dark:bg-white dark:text-slate-950"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied
              ? isZh
                ? "已复制"
                : "Copied"
              : isZh
                ? "复制安装命令"
                : "Copy install command"}
          </button>
        </div>
      </div>
    );
  }

  if (active === "macos") {
    return (
      <div className="border-t border-slate-200/80 p-6 dark:border-white/10 sm:p-8">
        <div className="flex items-center gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-slate-100 dark:bg-white/10">
            <AppleLogo />
          </span>
          <div>
            <h2 className="font-extrabold">OpenDrSai for macOS</h2>
            <p className="mt-1 text-sm font-medium text-slate-400">
              Coming soon
            </p>
          </div>
        </div>
      </div>
    );
  }

  const release = releases[active];
  return (
    <div className="border-t border-slate-200/80 p-6 dark:border-white/10 sm:p-8">
      <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 dark:bg-white/10">
              {release.icon}
            </span>
            <div>
              <h2 className="font-extrabold">{release.title}</h2>
              <p className="mt-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                {isZh ? "最新版本" : "Latest release"} · {release.version}
              </p>
            </div>
          </div>
          <dl className="mt-5 grid gap-x-8 gap-y-3 text-xs sm:grid-cols-[auto_1fr]">
            <dt className="font-semibold text-slate-400">
              {isZh ? "安装包" : "Package"}
            </dt>
            <dd className="min-w-0 break-all font-agent-mono text-slate-600 dark:text-slate-300">
              {release.file} · {release.size}
            </dd>
            {"programFile" in release && (
              <>
                <dt className="font-semibold text-slate-400">
                  {isZh ? "主体程序" : "Application package"}
                </dt>
                <dd className="min-w-0 break-all font-agent-mono text-slate-600 dark:text-slate-300">
                  {release.programFile} · {release.programSize}
                </dd>
              </>
            )}
            <dt className="font-semibold text-slate-400">SHA-256</dt>
            <dd className="min-w-0 break-all font-agent-mono text-slate-600 dark:text-slate-300">
              {release.sha256}
            </dd>
          </dl>
        </div>
        <a
          href={release.href}
          download=""
          className="inline-flex w-full flex-none items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-5 py-3 text-sm font-extrabold text-white no-underline shadow-lg shadow-violet-500/20 sm:w-auto"
        >
          <Download className="h-4 w-4" />
          {active === "android"
            ? isZh
              ? "下载软件包"
              : "Download package"
            : isZh
              ? "下载安装器"
              : "Download installer"}
        </a>
      </div>
      <a
        href="https://github.com/hepai-lab/drsai/releases"
        target="_blank"
        rel="noreferrer"
        className="mt-5 inline-flex text-xs font-semibold text-blue-600 underline decoration-blue-300 underline-offset-4 transition hover:text-blue-800 dark:text-blue-400 dark:decoration-blue-700 dark:hover:text-blue-300"
      >
        {isZh ? "历史版本" : "Previous releases"}
      </a>
    </div>
  );
};

export default WelcomePage;
