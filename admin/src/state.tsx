import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, setCsrfToken } from "./api";
import { initialRange, validRange } from "./model";
import type { Session } from "./types";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) =>
        !(error instanceof ApiError && [401, 403].includes(error.status)) &&
        count < 1,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

interface AuthState {
  session: Session | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<unknown>;
  clear: () => void;
}
const AuthContext = createContext<AuthState>(null!);
export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      try {
        const session = await api<Session>("auth/session");
        setCsrfToken(session.csrfToken);
        return session;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 0,
  });
  const clear = () => {
    setCsrfToken("");
    void client.cancelQueries();
    client.setQueryData(["session"], null);
    client.removeQueries({
      predicate: (query) => query.queryKey[0] !== "session",
    });
  };
  useEffect(() => {
    const expire = () => {
      setCsrfToken("");
      void client.cancelQueries();
      client.setQueryData(["session"], null);
      client.removeQueries({
        predicate: (query) => query.queryKey[0] !== "session",
      });
    };
    window.addEventListener("admin-session-expired", expire);
    return () => window.removeEventListener("admin-session-expired", expire);
  }, [client]);
  return (
    <AuthContext
      value={{
        session: query.data ?? null,
        loading: query.isPending,
        error: query.error,
        refresh: query.refetch,
        clear,
      }}
    >
      {children}
    </AuthContext>
  );
}
export const useAuth = () => useContext(AuthContext);

interface ReportState {
  from: string;
  to: string;
  timezone: string;
  params: URLSearchParams;
  valid: boolean;
  update: (value: { from?: string; to?: string; timezone?: string }) => void;
}
const ReportContext = createContext<ReportState>(null!);
export function ReportProvider({ children }: { children: ReactNode }) {
  const [range, setRange] = useState(() => ({
    ...initialRange(),
    timezone: "Africa/Lagos",
  }));
  const params = new URLSearchParams(range);
  return (
    <ReportContext
      value={{
        ...range,
        params,
        valid: validRange(range.from, range.to),
        update: (value) => setRange((old) => ({ ...old, ...value })),
      }}
    >
      {children}
    </ReportContext>
  );
}
export const useReport = () => useContext(ReportContext);
export function useReportQuery<T>(endpoint: string, extra = "") {
  const { params, valid } = useReport();
  return useQuery<T>({
    queryKey: ["report", endpoint, params.toString(), extra],
    queryFn: () => api<T>(`reports/${endpoint}?${params}${extra}`),
    enabled: valid,
  });
}
