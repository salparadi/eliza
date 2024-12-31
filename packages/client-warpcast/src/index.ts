import { Client, IAgentRuntime, elizaLogger } from "@elizaos/core";
import { WarpcastClient } from "./client";
import { WarpcastPostManager } from "./post";
import { WarpcastInteractionManager } from "./interactions";
import { tipAction } from './actions/tip';

export * from './actions/tip';
export * from './tools';

export class WarpcastAgentClient implements Client {
    client: WarpcastClient;
    posts: WarpcastPostManager;
    interactions: WarpcastInteractionManager;
    private cache: Map<string, any>;
    private static instanceCount = 0;

    constructor(
        public runtime: IAgentRuntime,
        client?: WarpcastClient
    ) {
        WarpcastAgentClient.instanceCount++;
        elizaLogger.info(`Creating WarpcastAgentClient instance #${WarpcastAgentClient.instanceCount}`);
        elizaLogger.info("Initialization call stack:",
            new Error().stack?.split('\n')
                .slice(1) // Remove the "Error" line
                .map(line => line.trim())
                .join('\n')
        );

        this.cache = new Map<string, any>();

        if (client) {
            elizaLogger.info("Using existing Warpcast client instance");
            this.client = client;
        } else {
            elizaLogger.info("Creating new Warpcast client instance");
            this.client = new WarpcastClient({
                runtime,
                fid: Number(runtime.getSetting("WARPCAST_FID")!),
                privateKey: runtime.getSetting("WARPCAST_PRIVATE_KEY")!,
                publicKey: runtime.getSetting("WARPCAST_PUBLIC_KEY")!,
                baseUrl: runtime.getSetting("WARPCAST_API_URL") || undefined,
                cache: this.cache,
            });
        }

        this.posts = new WarpcastPostManager(
            this.client,
            this.runtime,
            this.cache
        );

        this.interactions = new WarpcastInteractionManager(
            this.client,
            this.runtime,
            this.cache
        );

        // Register the tip action with the runtime
        if (runtime.getSetting('WARPCAST_TIPS_ENABLED') === 'true') {
            elizaLogger.info('Registering Warpcast tip action');
            runtime.registerAction(tipAction);
        }
    }

    async start() {
        await Promise.all([this.posts.start(), this.interactions.start()]);
    }

    async stop() {
        await Promise.all([this.posts.stop(), this.interactions.stop()]);
    }
}