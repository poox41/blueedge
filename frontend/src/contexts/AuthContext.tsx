import { useState, useCallback, useEffect } from "react";
import {
  clearBlueEdgeToken,
  getBlueEdgeToken,
  loginRequest,
  setBlueEdgeToken,
  ssoExchangeRequest,
} from "@/api/request";
import { AuthContext } from "@/contexts/auth-context";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return Boolean(getBlueEdgeToken());
  });

  const login = useCallback(async (username: string, password: string) => {
    try {
      const token = await loginRequest(username, password);
      setBlueEdgeToken(token);
      setIsAuthenticated(true);
      return true;
    } catch {
      clearBlueEdgeToken();
      setIsAuthenticated(false);
      return false;
    }
  }, []);

  const loginWithSsoCode = useCallback(async (code: string) => {
    const token = await ssoExchangeRequest(code);
    setBlueEdgeToken(token);
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(() => {
    clearBlueEdgeToken();
    setIsAuthenticated(false);
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => setIsAuthenticated(false);
    window.addEventListener("blueedge:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("blueedge:unauthorized", handleUnauthorized);
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, loginWithSsoCode, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
