export interface NovaApiConfig {
    baseUrl: string;
    username?: string;
    password?: string;
    token?: string;
    env?: 'live' | 'uat';
}
export declare function loadConfig(): NovaApiConfig;
