import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, ArrowLeft, Box, Loader2 } from "lucide-react";
import { startSsoExchangeOnce } from "@/auth/sso-exchange-once";
import { useAuth } from "@/contexts/auth-context";

type SsoStatus = "exchanging" | "error";

export function SsoPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { loginWithSsoCode } = useAuth();
  const started = useRef(false);
  const initialCode = useRef<string | undefined>(undefined);
  const [status, setStatus] = useState<SsoStatus>("exchanging");
  const [message, setMessage] = useState("正在验证 BAMS 登录凭证…");

  if (initialCode.current === undefined) {
    initialCode.current = new URLSearchParams(location.search).get("code")?.trim() || "";
  }

  useEffect(() => {
    const code = initialCode.current || "";
    startSsoExchangeOnce(
      started,
      () => navigate("/sso", { replace: true }),
      () => {
        if (!code) {
          setStatus("error");
          setMessage("未找到有效的 SSO 登录凭证，请返回 BAMS 重新进入 BlueEdge。");
          return;
        }
        void loginWithSsoCode(code)
          .then(() => navigate("/", { replace: true }))
          .catch(() => {
            setStatus("error");
            setMessage("SSO 登录未完成，请返回 BAMS 重新进入 BlueEdge。");
          });
      },
    );
  }, [loginWithSsoCode, navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f6f8] px-6">
      <section className="w-full max-w-[440px] rounded-[20px] border border-[#eef0f3] bg-white px-8 py-10 text-center shadow-[0_24px_60px_rgba(16,24,40,0.08)]">
        <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#111827] text-white">
          <Box className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold text-[#111827]">BlueEdge 单点登录</h1>
        <div className="mt-6 flex flex-col items-center gap-3">
          {status === "exchanging" ? (
            <Loader2 className="h-6 w-6 animate-spin text-[#111827]" aria-hidden="true" />
          ) : (
            <AlertCircle className="h-6 w-6 text-[#ef4444]" aria-hidden="true" />
          )}
          <p className={status === "error" ? "text-sm leading-6 text-[#b91c1c]" : "text-sm leading-6 text-[#6b7280]"}>
            {message}
          </p>
        </div>
        {status === "error" && (
          <div className="mt-7 flex flex-col gap-3">
            <button
              type="button"
              onClick={() => window.close()}
              className="flex h-11 items-center justify-center rounded-xl bg-[#111827] text-sm font-semibold text-white hover:bg-[#1f2937]"
            >
              关闭此页面并返回 BAMS
            </button>
            <Link to="/login" className="inline-flex items-center justify-center gap-1.5 text-sm text-[#4b5563] hover:text-[#111827]">
              <ArrowLeft className="h-4 w-4" />
              使用 BlueEdge 本地管理员登录
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
