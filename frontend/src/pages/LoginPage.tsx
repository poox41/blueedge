import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Eye,
  EyeOff,
  Server,
  Cloud,
  Shield,
  Layers,
  Cpu,
  Globe,
  ArrowRight,
  AlertCircle,
  Hexagon,
} from "lucide-react";

function FloatingNode({
  icon: Icon,
  top,
  left,
  size,
  delay,
}: {
  icon: React.ElementType;
  top: string;
  left: string;
  size: number;
  delay: number;
}) {
  return (
    <div
      className="absolute animate-float opacity-60"
      style={{
        top,
        left,
        animationDelay: `${delay}s`,
      }}
    >
      <Icon
        className="text-[var(--color-brand)]"
        style={{ width: size, height: size }}
      />
    </div>
  );
}

function ConnectionLine({
  top,
  left,
  width,
  angle,
  delay,
}: {
  top: string;
  left: string;
  width: number;
  angle: number;
  delay: number;
}) {
  return (
    <div
      className="absolute h-px animate-pulse-line bg-gradient-to-r from-transparent via-[var(--color-brand)] to-transparent"
      style={{
        top,
        left,
        width,
        transform: `rotate(${angle}deg)`,
        animationDelay: `${delay}s`,
        opacity: 0.22,
      }}
    />
  );
}

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Animated background particles
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    window.addEventListener("resize", resize);

    const particles: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      opacity: number;
    }> = [];

    for (let i = 0; i < 50; i++) {
      particles.push({
        x: Math.random() * canvas.offsetWidth,
        y: Math.random() * canvas.offsetHeight,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        size: Math.random() * 2 + 1,
        opacity: Math.random() * 0.5 + 0.1,
      });
    }

    let animationId: number;

    const draw = () => {
      ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);

      // Draw connections
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 150) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(30, 107, 255, ${0.12 * (1 - dist / 150)})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      // Draw particles
      particles.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(30, 107, 255, ${p.opacity})`;
        ctx.fill();

        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0 || p.x > canvas.offsetWidth) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.offsetHeight) p.vy *= -1;
      });

      animationId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationId);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const success = await login(username, password);
      if (success) {
        navigate("/");
      } else {
        setError("账号或密码错误，请重新输入");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full bg-[var(--color-bg-page)]">
      <div className="relative hidden overflow-hidden border-r border-[var(--color-border)] bg-white lg:flex lg:w-[54%]">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ opacity: 0.4 }}
        />

        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage: `linear-gradient(rgba(17,24,39,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(17,24,39,0.06) 1px, transparent 1px)`,
            backgroundSize: "56px 56px",
          }}
        />

        {/* Floating tech icons */}
        <FloatingNode icon={Cloud} top="12%" left="15%" size={36} delay={0} />
        <FloatingNode icon={Server} top="25%" left="65%" size={28} delay={1.2} />
        <FloatingNode icon={Cpu} top="45%" left="25%" size={32} delay={0.8} />
        <FloatingNode icon={Globe} top="60%" left="70%" size={24} delay={1.8} />
        <FloatingNode icon={Layers} top="75%" left="40%" size={30} delay={2.4} />
        <FloatingNode icon={Shield} top="35%" left="80%" size={22} delay={3.0} />

        {/* Connection lines */}
        <ConnectionLine top="18%" left="20%" width={120} angle={25} delay={0.5} />
        <ConnectionLine top="32%" left="35%" width={100} angle={-15} delay={1.0} />
        <ConnectionLine top="52%" left="30%" width={140} angle={40} delay={1.5} />
        <ConnectionLine top="68%" left="45%" width={110} angle={-30} delay={2.0} />

        <div className="absolute right-12 top-12 h-28 w-28 rounded-[24px] border border-[var(--color-border)] bg-[var(--color-bg-soft)]" />
        <div className="absolute bottom-16 left-12 h-20 w-36 rounded-[18px] border border-[var(--color-border)] bg-[var(--color-bg-soft)]" />

        <div className="relative z-10 flex max-w-3xl flex-col justify-center px-16">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-text-primary)] shadow-sm">
              <Hexagon className="h-6 w-6 text-white" />
            </div>
            <span className="text-2xl font-semibold text-[var(--color-text-primary)]">
              BlueEdge
            </span>
          </div>
          <h2 className="mb-5 text-5xl font-semibold leading-tight text-[var(--color-text-primary)]">
            云边协同平台
            <br />
            <span className="text-[var(--color-brand)]">统一管理边缘资源</span>
          </h2>
          <p className="max-w-xl text-base leading-7 text-[var(--color-text-secondary)]">
            基于 Kubernetes 的云原生边缘计算解决方案，实现云端与边缘节点的统一调度、设备管理与数据流转。
          </p>

          <div className="mt-9 flex flex-wrap gap-3">
            {["统一调度", "边缘自治", "设备孪生", "轻量化部署"].map(
              (tag) => (
                <span
                  key={tag}
                  className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] shadow-sm"
                >
                  {tag}
                </span>
              )
            )}
          </div>

          <div className="mt-12 grid max-w-lg grid-cols-3 gap-3">
            {[
              ["128", "边缘节点"],
              ["42", "节点组"],
              ["99.9%", "在线率"],
            ].map(([value, label]) => (
              <div key={label} className="rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-sm">
                <div className="text-xl font-semibold text-[var(--color-text-primary)]">{value}</div>
                <div className="mt-1 text-xs text-[var(--color-text-tertiary)]">{label}</div>
              </div>
            ))}
          </div>

          <div className="mt-10 flex items-center gap-6 text-xs text-[var(--color-text-tertiary)]">
            <span>Kubernetes v1.28.0</span>
            <span className="h-1 w-1 rounded-full bg-[var(--color-text-tertiary)]" />
            <span>BlueEdge v0.1.0</span>
          </div>
        </div>
      </div>

      <div className="relative flex flex-1 items-center justify-center px-6 py-12">
        <div className="absolute inset-0 lg:hidden bg-[var(--color-bg-page)]" />

        <div className="relative z-10 w-full max-w-[400px]">
          <div className="mb-8 flex items-center justify-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-text-primary)]">
              <Hexagon className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-semibold text-[var(--color-text-primary)]">BlueEdge</span>
          </div>

          <div className="rounded-2xl border border-[var(--color-border)] bg-white p-8 shadow-[var(--shadow-lg)]">
            <div className="mb-6">
              <h3 className="mb-1 text-xl font-semibold text-[var(--color-text-primary)]">欢迎登录</h3>
              <p className="text-sm text-[var(--color-text-tertiary)]">
                请输入账号密码访问管理平台
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label
                  htmlFor="username"
                  className="text-sm font-medium text-[var(--color-text-secondary)]"
                >
                  账号
                </Label>
                <div className="relative">
                  <Server className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
                  <Input
                    id="username"
                    type="text"
                    placeholder="请输入账号"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      setError("");
                    }}
                    className="h-11 pl-10 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="password"
                  className="text-sm font-medium text-[var(--color-text-secondary)]"
                >
                  密码
                </Label>
                <div className="relative">
                  <Shield className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="请输入密码"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setError("");
                    }}
                    className="h-11 pl-10 pr-10 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Error message */}
              {error && (
                <div className="flex animate-shake items-center gap-2 rounded-lg border border-[var(--color-danger)]/20 bg-[var(--color-danger-soft)] px-3 py-2.5 text-sm text-[var(--color-danger)]">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button
                type="submit"
                disabled={isLoading || !username || !password}
                className="h-11 w-full text-sm font-medium"
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <svg
                      className="animate-spin h-4 w-4"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    登录中...
                  </span>
                ) : (
                  <span className="flex items-center gap-2 justify-center">
                    登录
                    <ArrowRight className="h-4 w-4" />
                  </span>
                )}
              </Button>
            </form>

          </div>

          {/* Footer */}
          <p className="mt-6 text-center text-xs text-[var(--color-text-tertiary)]">
            BlueEdge · 云边协同与边缘应用管理平台
          </p>
        </div>
      </div>

      {/* Global CSS for animations */}
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-15px); }
        }
        @keyframes pulse-line {
          0%, 100% { opacity: 0.1; }
          50% { opacity: 0.4; }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }
        .animate-float {
          animation: float 4s ease-in-out infinite;
        }
        .animate-pulse-line {
          animation: pulse-line 3s ease-in-out infinite;
        }
        .animate-shake {
          animation: shake 0.3s ease-in-out;
        }
      `}</style>
    </div>
  );
}
