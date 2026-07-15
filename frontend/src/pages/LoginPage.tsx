import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  Box,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  ShieldCheck,
  User,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const capabilityTags = ["边缘单元管理", "工作负载部署", "配置项与密钥", "消息路由", "日志与监控"];
const rememberedAccountKey = "blueedge_remembered_account";

function LoginLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={
          compact
            ? "flex h-10 w-10 items-center justify-center rounded-2xl bg-[#111827]"
            : "flex h-11 w-11 items-center justify-center rounded-2xl bg-[#111827] shadow-[0_12px_28px_rgba(17,24,39,0.16)]"
        }
      >
        <Box className={compact ? "h-5 w-5 text-white" : "h-[22px] w-[22px] text-white"} />
      </div>
      <div>
        <div className="text-lg font-semibold leading-6 text-[#111827]">BlueEdge</div>
        <div className="text-xs leading-5 text-[#6b7280]">
          {compact ? "云边协同管理平台" : "Enterprise Cloud-Edge Console"}
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const rememberedAccount = window.localStorage.getItem(rememberedAccountKey) || "";
  const [username, setUsername] = useState(rememberedAccount);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(Boolean(rememberedAccount));
  const [showPassword, setShowPassword] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [helpMessage, setHelpMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const accountError = submitted && !username.trim() ? "请输入账号" : "";
  const passwordError = submitted && !password ? "请输入密码" : "";

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setError("");
    setHelpMessage("");
    if (!username.trim() || !password) return;

    setIsLoading(true);
    try {
      const success = await login(username.trim(), password);
      if (!success) {
        setError("账号或密码错误，请重新输入");
        return;
      }
      if (remember) {
        window.localStorage.setItem(rememberedAccountKey, username.trim());
      } else {
        window.localStorage.removeItem(rememberedAccountKey);
      }
      navigate("/");
    } finally {
      setIsLoading(false);
    }
  };

  const clearFeedback = () => {
    setError("");
    setHelpMessage("");
  };

  return (
    <main className="flex min-h-screen w-full overflow-hidden bg-[#f5f6f8]">
      <section className="relative hidden min-w-0 w-[60%] flex-col justify-between px-12 py-10 lg:flex xl:px-20 xl:py-16">
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="absolute left-20 top-24 h-[520px] w-[520px] rounded-full border border-[#e5e7eb]" />
          <div className="absolute left-44 top-48 h-[360px] w-[360px] rounded-full border border-[#eef0f3]" />
          <div className="absolute bottom-20 right-20 h-72 w-72 rotate-12 rounded-[32px] border border-[#e5e7eb]" />
        </div>

        <div className="relative z-10">
          <LoginLogo />
        </div>

        <div className="relative z-10 max-w-[640px]">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[#e5e7eb] bg-white px-3 py-1.5 text-xs text-[#4b5563]">
            <ShieldCheck className="h-3.5 w-3.5" />
            企业级云边管理平台
          </div>
          <h1 className="mb-5 text-[36px] font-semibold leading-[1.18] tracking-[-0.01em] text-[#111827] xl:text-[40px]">
            统一管理边缘资源、工作负载与消息路由
          </h1>
          <p className="max-w-[560px] text-sm leading-7 text-[#4b5563] xl:text-base xl:leading-8">
            面向边缘节点、命名空间、工作负载、配置项、密钥、消息路由等资源的一体化管理控制台，帮助用户完成边缘应用的部署、监控、运维与治理。
          </p>

          <div className="mt-9 flex flex-wrap gap-3">
            {capabilityTags.map((tag) => (
              <span
                key={tag}
                className="rounded-xl border border-[#e5e7eb] bg-white px-3.5 py-2 text-sm text-[#374151] shadow-[0_6px_18px_rgba(16,24,40,0.04)]"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div className="relative z-10 text-xs text-[#9ca3af]">
          © 2026 BlueEdge Console. All rights reserved.
        </div>
      </section>

      <section className="flex min-w-0 flex-1 items-center justify-center px-6 py-10 lg:px-10 xl:px-16">
        <div className="w-full max-w-[430px]">
          <div className="mb-8 lg:hidden">
            <LoginLogo compact />
          </div>

          <form
            onSubmit={handleSubmit}
            className="rounded-[20px] border border-[#eef0f3] bg-white px-7 py-8 shadow-[0_24px_60px_rgba(16,24,40,0.08)] sm:px-11 sm:pb-10 sm:pt-11"
          >
            <div className="mb-8">
              <h2 className="mb-2 text-2xl font-semibold leading-8 text-[#111827]">欢迎登录</h2>
              <p className="text-sm text-[#6b7280]">云边协同管理平台 BlueEdge</p>
            </div>

            {error && (
              <div className="mb-5 flex items-center gap-2 rounded-xl border border-[#fecaca] bg-[#fff0f0] px-3 py-2.5 text-sm text-[#ef4444]" role="alert">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {helpMessage && (
              <div className="mb-5 rounded-xl border border-[#bfdbfe] bg-[#eff6ff] px-3 py-2.5 text-sm text-[#2563eb]">
                {helpMessage}
              </div>
            )}

            <div className="space-y-5">
              <div>
                <label htmlFor="username" className="mb-2 block text-sm font-medium text-[#111827]">
                  账号
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9ca3af]" />
                  <input
                    id="username"
                    value={username}
                    onChange={(event) => {
                      setUsername(event.target.value);
                      clearFeedback();
                    }}
                    autoComplete={remember ? "username" : "off"}
                    aria-invalid={Boolean(accountError)}
                    className="h-[46px] w-full rounded-xl border border-[#e5e7eb] bg-white pl-[38px] pr-3 text-sm text-[#111827] outline-none transition placeholder:text-[#9ca3af] focus:border-[#111827] focus:shadow-[0_0_0_3px_rgba(17,24,39,0.08)] aria-invalid:border-[#ef4444] aria-invalid:shadow-[0_0_0_2px_rgba(239,68,68,0.08)]"
                    placeholder="请输入账号 / 用户名"
                  />
                </div>
                {accountError && <p className="mt-1.5 text-xs text-[#ef4444]">{accountError}</p>}
              </div>

              <div>
                <label htmlFor="password" className="mb-2 block text-sm font-medium text-[#111827]">
                  密码
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9ca3af]" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      clearFeedback();
                    }}
                    autoComplete="current-password"
                    aria-invalid={Boolean(passwordError)}
                    className="h-[46px] w-full rounded-xl border border-[#e5e7eb] bg-white pl-[38px] pr-[42px] text-sm text-[#111827] outline-none transition placeholder:text-[#9ca3af] focus:border-[#111827] focus:shadow-[0_0_0_3px_rgba(17,24,39,0.08)] aria-invalid:border-[#ef4444] aria-invalid:shadow-[0_0_0_2px_rgba(239,68,68,0.08)]"
                    placeholder="请输入密码"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-[#9ca3af] transition hover:bg-[#f5f6f8] hover:text-[#111827]"
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {passwordError && <p className="mt-1.5 text-xs text-[#ef4444]">{passwordError}</p>}
              </div>
            </div>

            <div className="mb-7 mt-5 flex items-center justify-between">
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-[#4b5563]">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                  className="h-4 w-4 rounded accent-[#111827]"
                />
                记住账号
              </label>
              <button
                type="button"
                onClick={() => {
                  setError("");
                  setHelpMessage("当前平台暂未开放自助找回密码，请联系系统管理员重置。");
                }}
                className="text-sm font-medium text-[#111827] hover:underline"
              >
                忘记密码？
              </button>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#111827] text-sm font-semibold text-white transition hover:bg-[#1f2937] disabled:cursor-not-allowed disabled:bg-[#6b7280]"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  登录中...
                </>
              ) : (
                <>
                  登录
                  <ArrowRight className="h-[15px] w-[15px]" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 text-center text-xs text-[#9ca3af]">BlueEdge Console v1.2.0</div>
        </div>
      </section>
    </main>
  );
}
