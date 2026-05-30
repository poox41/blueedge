import { createContext, useContext, useState, useCallback } from "react";
import { clearBlueEdgeToken, getBlueEdgeToken, loginRequest, setBlueEdgeToken } from "@/api/request";

interface AuthContextType {
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

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

  const logout = useCallback(() => {
    clearBlueEdgeToken();
    setIsAuthenticated(false);
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
