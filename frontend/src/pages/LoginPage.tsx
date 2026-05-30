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
      className="absolute animate-float opacity-20"
      style={{
        top,
        left,
        animationDelay: `${delay}s`,
      }}
    >
      <Icon
        className="text-[#165DFF]"
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
      className="absolute h-[1px] bg-gradient-to-r from-transparent via-[#165DFF] to-transparent animate-pulse-line"
      style={{
        top,
        left,
        width,
        transform: `rotate(${angle}deg)`,
        animationDelay: `${delay}s`,
        opacity: 0.3,
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
            ctx.strokeStyle = `rgba(22, 93, 255, ${0.15 * (1 - dist / 150)})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      // Draw particles
      particles.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(22, 93, 255, ${p.opacity})`;
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
    <div className="min-h-screen w-full flex bg-[#0A1628]">
      {/* Left side - Tech decorative area */}
      <div className="hidden lg:flex lg:w-[55%] relative overflow-hidden">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ opacity: 0.8 }}
        />

        {/* Grid background */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: `linear-gradient(rgba(22,93,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(22,93,255,0.5) 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
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

        {/* Glowing orbs */}
        <div className="absolute top-[20%] left-[30%] w-64 h-64 bg-[#165DFF] rounded-full blur-[120px] opacity-10" />
        <div className="absolute bottom-[20%] right-[20%] w-48 h-48 bg-[#00B42A] rounded-full blur-[100px] opacity-8" />
        <div className="absolute top-[50%] left-[50%] w-32 h-32 bg-[#165DFF] rounded-full blur-[80px] opacity-10" />

        {/* Content overlay */}
        <div className="relative z-10 flex flex-col justify-center px-16">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-[#165DFF]/20 border border-[#165DFF]/30 flex items-center justify-center backdrop-blur-sm">
              <Hexagon className="w-6 h-6 text-[#165DFF]" />
            </div>
            <span className="text-2xl font-bold text-white tracking-wide">
              BlueEdge
            </span>
          </div>
          <h2 className="text-4xl font-bold text-white mb-4 leading-tight">
            云边协同
            <br />
            <span className="text-[#165DFF]">边缘智能平台</span>
          </h2>
          <p className="text-[#86909C] text-base leading-relaxed max-w-md">
            基于 Kubernetes 的云原生边缘计算解决方案，实现云端与边缘节点的统一调度、设备管理与数据流转。
          </p>

          {/* Feature badges */}
          <div className="flex flex-wrap gap-3 mt-8">
            {["统一调度", "边缘自治", "设备孪生", "轻量化部署"].map(
              (tag) => (
                <span
                  key={tag}
                  className="px-3 py-1.5 rounded-md text-xs text-[#165DFF] bg-[#165DFF]/10 border border-[#165DFF]/20"
                >
                  {tag}
                </span>
              )
            )}
          </div>

          {/* Version info */}
          <div className="mt-12 flex items-center gap-6 text-xs text-[#4E5969]">
            <span>Kubernetes v1.28.0</span>
            <span className="w-1 h-1 rounded-full bg-[#4E5969]" />
            <span>BlueEdge v0.1.0</span>
          </div>
        </div>
      </div>

      {/* Right side - Login form */}
      <div className="flex-1 flex items-center justify-center px-8 py-12 relative">
        {/* Subtle gradient on mobile */}
        <div className="absolute inset-0 lg:hidden bg-gradient-to-br from-[#0A1628] via-[#0D1D33] to-[#0A1628]" />

        <div className="relative z-10 w-full max-w-[400px]">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <div className="w-10 h-10 rounded-lg bg-[#165DFF]/20 border border-[#165DFF]/30 flex items-center justify-center">
              <Hexagon className="w-5 h-5 text-[#165DFF]" />
            </div>
            <span className="text-xl font-bold text-white">BlueEdge</span>
          </div>

          <div className="bg-[#111E2E]/80 backdrop-blur-md rounded-xl border border-[#1D3555] p-8 shadow-2xl">
            <div className="mb-6">
              <h3 className="text-xl font-semibold text-white mb-1">欢迎登录</h3>
              <p className="text-sm text-[#86909C]">
                请输入账号密码访问管理平台
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label
                  htmlFor="username"
                  className="text-sm text-[#C9CDD4] font-medium"
                >
                  账号
                </Label>
                <div className="relative">
                  <Server className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#4E5969]" />
                  <Input
                    id="username"
                    type="text"
                    placeholder="请输入账号"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      setError("");
                    }}
                    className="pl-10 h-11 bg-[#0A1628] border-[#1D3555] text-white placeholder:text-[#4E5969] focus-visible:ring-[#165DFF] focus-visible:border-[#165DFF] transition-all"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="password"
                  className="text-sm text-[#C9CDD4] font-medium"
                >
                  密码
                </Label>
                <div className="relative">
                  <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#4E5969]" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="请输入密码"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setError("");
                    }}
                    className="pl-10 pr-10 h-11 bg-[#0A1628] border-[#1D3555] text-white placeholder:text-[#4E5969] focus-visible:ring-[#165DFF] focus-visible:border-[#165DFF] transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#4E5969] hover:text-[#86909C] transition-colors"
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
                <div className="flex items-center gap-2 text-sm text-[#F53F3F] bg-[#F53F3F]/10 border border-[#F53F3F]/20 rounded-md px-3 py-2.5 animate-shake">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button
                type="submit"
                disabled={isLoading || !username || !password}
                className="w-full h-11 bg-[#165DFF] hover:bg-[#165DFF]/90 text-white font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
                    <ArrowRight className="w-4 h-4" />
                  </span>
                )}
              </Button>
            </form>

          </div>

          {/* Footer */}
          <p className="text-xs text-[#4E5969] text-center mt-6">
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
