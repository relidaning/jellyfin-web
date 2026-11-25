declare module '@/scripts/settings/webSettings' {
    export function getMultiServer(): Promise<boolean>;
    export function getPlugins(): Promise<string[]>;
    export function getServers(): Promise<string[]>;
}
