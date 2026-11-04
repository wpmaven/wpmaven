// Type declarations for JavaScript services

declare module '../services/api' {
  interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
  }

  interface Api {
    get<T = unknown>(endpoint: string, params?: Record<string, unknown>): Promise<ApiResponse<T>>;
    post<T = unknown>(endpoint: string, data?: unknown): Promise<ApiResponse<T>>;
    delete<T = unknown>(endpoint: string): Promise<ApiResponse<T>>;
  }

  export const api: Api;
}
