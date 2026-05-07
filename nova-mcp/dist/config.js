import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const CONFIG_PATH = resolve(PROJECT_ROOT, 'config.json');
export function loadConfig() {
    let raw;
    try {
        raw = readFileSync(CONFIG_PATH, 'utf-8');
    }
    catch (err) {
        throw new Error(`Could not read ${CONFIG_PATH}: ${err instanceof Error ? err.message : err}. ` +
            `Create config.json with { "api": { "baseUrl": "https://nova.nurtur.tech", "username": "...", "password": "..." } }`);
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (err) {
        throw new Error(`Invalid JSON in ${CONFIG_PATH}: ${err instanceof Error ? err.message : err}`);
    }
    const api = parsed.api;
    if (!api?.baseUrl) {
        throw new Error(`config.json is missing api.baseUrl. Expected { "api": { "baseUrl": "https://nova.nurtur.tech", ... } }`);
    }
    if (!api.token && (!api.username || !api.password)) {
        throw new Error(`config.json must provide either api.token or api.username + api.password`);
    }
    return {
        baseUrl: api.baseUrl.replace(/\/+$/, ''),
        username: api.username,
        password: api.password,
        token: api.token,
        env: api.env ?? 'live',
    };
}
//# sourceMappingURL=config.js.map