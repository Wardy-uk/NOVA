export declare function novaGet<T = unknown>(path: string, params?: Record<string, string | number>): Promise<T>;
export declare function novaPost<T = unknown>(path: string, body?: unknown): Promise<T>;
export declare function novaPut<T = unknown>(path: string, body?: unknown): Promise<T>;
export declare function novaDelete<T = unknown>(path: string): Promise<T>;
