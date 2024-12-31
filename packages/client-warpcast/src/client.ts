import axios, { AxiosInstance } from 'axios';
import { toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { IAgentRuntime, elizaLogger } from "@elizaos/core";
import { WarpcastClientConfig, WarpcastAuthHeader, WarpcastAuthPayload, CastResponse, UserResponse, CastOptions, NotificationResponse, Channel, WarpcastError, Cast, Profile, Verification } from './types';
import { RateLimiter } from './utils/rateLimiter';

const MAX_CACHE_SIZE = 1000; // Maximum number of items in cache
const CACHE_EXPIRY = 30 * 60 * 1000; // 30 minutes in milliseconds

interface CacheEntry<T> {
    value: T;
    timestamp: number;
}

export class WarpcastClient {
    private client!: AxiosInstance;
    private config!: WarpcastClientConfig;
    private rateLimiter!: RateLimiter;
    private cachedToken: { token: string; expiresAt: number } | null = null;
    private lastCacheCleanup: number = Date.now();
    runtime!: IAgentRuntime;
    cache!: Map<string, CacheEntry<any>>;
    lastInteractionTimestamp!: Date;
    private static instanceCount = 0;
    private tokenGenerationPromise: Promise<string> | null = null;

    constructor(opts: {
        runtime: IAgentRuntime;
        fid: number;
        privateKey: string;
        publicKey: string;
        baseUrl?: string;
        cache: Map<string, any>;
    }) {
        WarpcastClient.instanceCount++;
        elizaLogger.info(`Creating WarpcastClient instance #${WarpcastClient.instanceCount}`);
        elizaLogger.info("Initialization call stack:",
            new Error().stack?.split('\n')
                .slice(1) // Remove the "Error" line
                .map(line => line.trim())
                .join('\n')
        );

        this.cache = new Map();
        this.runtime = opts.runtime;
        this.lastInteractionTimestamp = new Date();
        this.config = {
            fid: opts.fid,
            privateKey: opts.privateKey,
            publicKey: opts.publicKey,
            baseUrl: opts.baseUrl,
        };
        // Initialize rate limiter with Warpcast's limits (100 requests per minute)
        this.rateLimiter = new RateLimiter(100, 60 * 1000);

        this.client = axios.create({
            baseURL: opts.baseUrl || 'https://api.warpcast.com',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        // Add request interceptor to add auth token
        this.client.interceptors.request.use(async (config) => {

            let authToken = this.runtime.getSetting('WARPCAST_BEARER_TOKEN');

            if (!authToken) {
                authToken = await this.getValidAuthToken();
            }

            config.headers.Authorization = `Bearer ${authToken}`;

            // Debug logging
            // console.log('Auth Token Details:', {
            //     token: authToken,
            //     cachedToken: this.cachedToken ? {
            //         expiresAt: this.cachedToken.expiresAt,
            //         expiresIn: this.cachedToken.expiresAt - Math.floor(Date.now()),
            //         now: Math.floor(Date.now())
            //     } : null
            // });

            return config;
        });

        // Start periodic cache cleanup
        setInterval(() => this.cleanupCache(), CACHE_EXPIRY);
    }

    private cleanupCache() {
        const now = Date.now();
        let count = 0;

        // Clean expired entries
        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > CACHE_EXPIRY) {
                this.cache.delete(key);
            } else {
                count++;
            }
        }

        // If still too many entries, remove oldest
        if (count > MAX_CACHE_SIZE) {
            const entries = Array.from(this.cache.entries())
                .sort((a, b) => a[1].timestamp - b[1].timestamp);

            const toRemove = entries.slice(0, count - MAX_CACHE_SIZE);
            for (const [key] of toRemove) {
                this.cache.delete(key);
            }
        }
    }

    private setCacheEntry<T>(key: string, value: T) {
        // Clean cache if it's getting too large
        if (this.cache.size >= MAX_CACHE_SIZE) {
            this.cleanupCache();
        }

        this.cache.set(key, {
            value,
            timestamp: Date.now()
        });
    }

    private getCacheEntry<T>(key: string): T | null {
        const entry = this.cache.get(key);
        if (!entry) return null;

        // Check if entry has expired
        if (Date.now() - entry.timestamp > CACHE_EXPIRY) {
            this.cache.delete(key);
            return null;
        }

        return entry.value;
    }

    private async getValidAuthToken(): Promise<string> {
        const now = Date.now();  // Current time in milliseconds
        const REFRESH_BUFFER = 30 * 60 * 1000;  // 30 minutes in milliseconds

        // If we have a valid cached token, use it
        if (this.cachedToken &&
            this.cachedToken.expiresAt > now &&
            this.cachedToken.expiresAt < (now + (24 * 60 * 60 * 1000)) && // 24 hours in milliseconds
            this.cachedToken.expiresAt > (now + REFRESH_BUFFER)) {
            elizaLogger.info('Using cached token', {
                instanceId: WarpcastClient.instanceCount,
                expiresIn: Math.floor((this.cachedToken.expiresAt - now) / 1000),  // Show in seconds for readability
                readableExpiry: new Date(this.cachedToken.expiresAt).toISOString()
            });
            return this.cachedToken.token;
        }

        // If we're already generating a token, wait for that to complete
        if (this.tokenGenerationPromise) {
            elizaLogger.info('Waiting for existing token generation to complete', {
                instanceId: WarpcastClient.instanceCount
            });
            return this.tokenGenerationPromise;
        }

        // Start new token generation
        elizaLogger.info('Starting new token generation', {
            instanceId: WarpcastClient.instanceCount,
            reason: this.cachedToken ? 'token_expired' : 'no_token'
        });

        try {
            this.tokenGenerationPromise = this.generateAuthToken();
            const token = await this.tokenGenerationPromise;

            this.cachedToken = {
                token,
                expiresAt: now + (8 * 60 * 60 * 1000)  // 8 hours in milliseconds
            };

            return token;
        } finally {
            this.tokenGenerationPromise = null;
        }
    }

    private async generateAuthToken(method: string = 'read'): Promise<string> {
        const now = Math.floor(Date.now() / 1000);
        const account = privateKeyToAccount(this.config.privateKey as `0x${string}`);
        const TOKEN_DURATION = 1 * 60 * 60; // 1 hour

        const signPayload = {
            method: "generateToken",
            params: {
                timestamp: now * 1000,
                //expiresAt: (now + TOKEN_DURATION) * 1000
            }
        };

        elizaLogger.info('Generating auth token with payload:', JSON.stringify({
            ...signPayload,
            //readableExpiry: new Date(signPayload.params.expiresAt).toISOString()
        }, null, 2));

        try {
            // Sort keys at each level for canonical JSON
            const canonicalJson = JSON.stringify(signPayload, (_, value) => {
                if (value && typeof value === 'object') {
                    return Object.keys(value).sort().reduce((sorted: any, key) => {
                        sorted[key] = value[key];
                        return sorted;
                    }, {});
                }
                return value;
            });

            // Sign the canonical JSON
            const signature = await account.signMessage({
                message: canonicalJson
            });

            // Convert to bytes and encode as base64
            const custodyToken = `eip191:${Buffer.from(toBytes(signature)).toString('base64')}`;

            elizaLogger.info('Sending auth request with custody token:', custodyToken);
            elizaLogger.info('Sign payload:', signPayload);

            // This section generates an auth token for the Warpcast API:
            // 1. Creates a payload with timestamp and expiry
            // 2. Signs it with the user's private key to prove ownership
            // 3. Encodes signature as base64 custody token
            // 4. Sends signed request to get auth token from Warpcast
            const response = await axios.put(
                `${this.config.baseUrl || 'https://api.warpcast.com'}/v2/auth`,
                signPayload,
                {
                    headers: {
                        'Authorization': `Bearer ${custodyToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            elizaLogger.info('Auth token generated successfully');
            return response.data.result.token.secret;
        } catch (error: any) {
            console.error('Error generating auth token:', error.response?.data || error);
            throw new Error('Failed to generate auth token: ' + (error.response?.data?.message || error.message));
        }
    }

    public async deleteAuth(): Promise<void> {
        try {
            await this.client.delete(`${this.config.baseUrl || 'https://api.warpcast.com'}/v2/auth`);
            this.cachedToken = null;
            elizaLogger.info('Successfully deleted auth token');
        } catch (error: any) {
            console.error('Error deleting auth token:', error.response?.data || error);
            throw new Error('Failed to delete auth token: ' + (error.response?.data?.message || error.message));
        }
    }

    private async makeRequest<T>(key: string, fn: () => Promise<T>): Promise<T> {
        return this.rateLimiter.execute(key, fn);
    }

    async getThreadCasts(hash: string): Promise<Cast[]> {
        const cacheKey = `warpcast/threadCasts/${hash}`;
        const cached = this.getCacheEntry<Cast[]>(cacheKey);
        if (cached) return cached;

        const response = await this.makeRequest(`getThreadCasts-${hash}`, () =>
            this.client.get(`/v2/thread-casts`, { params: { castHash: hash } })
        );

        const casts: Cast[] = response.data.result.casts.map((castResponse: any) => ({
            hash: castResponse.hash,
            authorFid: castResponse.author.fid,
            text: castResponse.text,
            profile: this.getProfile(castResponse.author.fid),
            ...(castResponse.parentHash ? {
                inReplyTo: {
                    hash: castResponse.parentHash,
                    fid: castResponse.parentAuthor.fid,
                },
            } : {}),
            timestamp: new Date(castResponse.timestamp),
        }));

        this.setCacheEntry(cacheKey, casts);
        return casts;
    }

    async getCast(hash: string): Promise<Cast> {
        const cacheKey = `warpcast/cast/${hash}`;
        const cached = this.getCacheEntry<Cast>(cacheKey);
        if (cached) return cached;

        const response = await this.makeRequest(`getCast-${hash}`, () =>
            this.client.get(`/v2/thread-casts`, {
                params: { castHash: hash }
            })
        );

        // Find the specific cast we want in the thread
        const castResponse = response.data.result.casts.find((c: any) => c.hash === hash);
        if (!castResponse) {
            throw new Error(`Cast ${hash} not found in thread`);
        }

        const profile = await this.getProfile(castResponse.author.fid);
        const cast: Cast = {
            hash: castResponse.hash,
            authorFid: castResponse.author.fid,
            text: castResponse.text,
            profile,
            ...(castResponse.parentHash ? {
                inReplyTo: {
                    hash: castResponse.parentHash,
                    fid: castResponse.parentAuthor.fid,
                },
            } : {}),
            timestamp: new Date(castResponse.timestamp),
        };

        this.setCacheEntry(cacheKey, cast);
        return cast;
    }

    async getUserByFid(fid: number): Promise<UserResponse> {
        return this.makeRequest(`getUserByFid-${fid}`, async () => {
            const response = await this.client.get(`/v2/user`, {
                params: { fid }
            });
            return response.data.result.user;
        });
    }

    async getUserByUsername(username: string): Promise<UserResponse> {
        return this.makeRequest(`getUserByUsername-${username}`, async () => {
            const response = await this.client.get(`/v2/user-by-username`, {
                params: { username }
            });
            return response.data.result.user;
        });
    }

    async getCastsByFid(fid: number, limit: number = 25, cursor?: string): Promise<{
        casts: CastResponse[];
        next?: string;
    }> {
        return this.makeRequest(`getCastsByFid-${fid}`, async () => {
            const params = new URLSearchParams();
            params.append('limit', limit.toString());
            if (cursor) {
                params.append('cursor', cursor);
            }
            params.append('fid', fid.toString());

            const response = await this.client.get(`/v2/casts`, { params });
            return {
                casts: response.data.result.casts,
                next: response.data.result.next,
            };
        });
    }

    async getReplies(hash: string, limit: number = 25, cursor?: string): Promise<{
        replies: CastResponse[];
        next?: string;
    }> {
        return this.makeRequest(`getReplies-${hash}`, async () => {
            const params = new URLSearchParams();
            params.append('limit', limit.toString());
            if (cursor) {
                params.append('cursor', cursor);
            }

            const response = await this.client.get(`/v2/all-casts-in-thread`, {
                params: {
                    threadHash: hash,
                    ...params
                }
            });
            return {
                replies: response.data.result.casts,
                next: response.data.result.next,
            };
        });
    }

    async getLikes(hash: string, limit: number = 25, cursor?: string): Promise<{
        users: UserResponse[];
        next?: string;
    }> {
        return this.makeRequest(`getLikes-${hash}`, async () => {
            const params = new URLSearchParams();
            params.append('limit', limit.toString());
            if (cursor) {
                params.append('cursor', cursor);
            }
            params.append('castHash', hash);

            const response = await this.client.get(`/v2/cast-likes`, { params });
            return {
                users: response.data.result.users,
                next: response.data.result.next,
            };
        });
    }

    async getRecasts(hash: string, limit: number = 25, cursor?: string): Promise<{
        users: UserResponse[];
        next?: string;
    }> {
        return this.makeRequest(`getRecasts-${hash}`, async () => {
            const params = new URLSearchParams();
            params.append('limit', limit.toString());
            if (cursor) {
                params.append('cursor', cursor);
            }
            params.append('castHash', hash);

            const response = await this.client.get(`/v2/cast-recasters`, { params });
            return {
                users: response.data.result.users,
                next: response.data.result.next,
            };
        });
    }

    async publishCast(options: CastOptions): Promise<CastResponse> {
        try {
            const response = await this.makeRequest('publishCast', () =>
                this.client.post('/v2/casts', {
                    text: options.text,
                    embeds: options.embeds,
                    parent: options.parent,
                    channel_key: options.channelId,
                })
            );
            return response.data.result.cast;
        } catch (error) {
            throw this.handleError(error);
        }
    }

    async likeCast(hash: string): Promise<boolean> {
        try {
            await this.makeRequest(`likeCast-${hash}`, () =>
                this.client.put(`/v2/cast-likes`, {
                    cast_hash: hash
                })
            );
            return true;
        } catch (error) {
            throw this.handleError(error);
        }
    }

    async unlikeCast(hash: string): Promise<boolean> {
        try {
            await this.makeRequest(`unlikeCast-${hash}`, () =>
                this.client.delete(`/v2/cast-likes`, {
                    data: { cast_hash: hash }
                })
            );
            return true;
        } catch (error) {
            throw this.handleError(error);
        }
    }

    async recast(hash: string): Promise<boolean> {
        try {
            await this.makeRequest(`recast-${hash}`, () =>
                this.client.put(`/v2/recasts`, {
                    cast_hash: hash
                })
            );
            return true;
        } catch (error) {
            throw this.handleError(error);
        }
    }

    async unrecast(hash: string): Promise<boolean> {
        try {
            await this.makeRequest(`unrecast-${hash}`, () =>
                this.client.delete(`/v2/recasts`, {
                    data: { cast_hash: hash }
                })
            );
            return true;
        } catch (error) {
            throw this.handleError(error);
        }
    }

    async followUser(targetFid: number): Promise<boolean> {
        try {
            await this.makeRequest(`followUser-${targetFid}`, () =>
                this.client.put(`/v2/follows`, {
                    target_fid: targetFid
                })
            );
            return true;
        } catch (error) {
            throw this.handleError(error);
        }
    }

    async unfollowUser(targetFid: number): Promise<boolean> {
        try {
            await this.makeRequest(`unfollowUser-${targetFid}`, () =>
                this.client.delete(`/v2/follows`, {
                    data: { target_fid: targetFid }
                })
            );
            return true;
        } catch (error) {
            throw this.handleError(error);
        }
    }

    async getNotifications(limit: number = 25, cursor?: string): Promise<{
        casts: Cast[];
        next?: { cursor: string };
    }> {
        return this.makeRequest('getNotifications', async () => {
            const params = new URLSearchParams();
            params.append('limit', limit.toString());
            params.append('tab', 'all');
            if (cursor) {
                params.append('cursor', cursor);
            }

            const response = await this.client.get(`/v1/notifications-for-tab?${params.toString()}`);
            const result = response.data.result;

            // Filter and transform notifications into Casts
            const casts: Cast[] = result.notifications
                .filter(n => (n.type === 'cast-reply' || n.type === 'cast-mention') && n.previewItems[0]?.content?.cast)
                .map(notification => {
                    const mention = notification.previewItems[0];
                    const cast: Cast = {
                        hash: mention.content.cast.hash,
                        authorFid: mention.actor.fid,
                        text: mention.content.cast.text,
                        profile: {
                            fid: mention.actor.fid,
                            name: mention.actor.displayName,
                            username: mention.actor.username,
                            bio: mention.actor.profile?.bio?.text || "",
                            pfp: mention.actor.pfp?.url,
                        },
                        ...(mention.content.cast.parentHash ? {
                            inReplyTo: {
                                hash: mention.content.cast.parentHash,
                                fid: mention.content.cast.parentAuthor?.fid,
                            },
                        } : {}),
                        timestamp: new Date(mention.timestamp),
                    };

                    // Cache the cast
                    this.setCacheEntry(`warpcast/cast/${cast.hash}`, cast);
                    return cast;
                });

            return {
                casts,
                next: result.next ? { cursor: result.next.cursor } : undefined
            };
        });
    }

    async getChannel(channelId: string): Promise<Channel> {
        try {
            return this.makeRequest(`getChannel-${channelId}`, async () => {
                const response = await this.client.get(`/v2/channel/${channelId}`);
                return response.data.result.channel;
            });
        } catch (error) {
            throw this.handleError(error);
        }
    }

    async getProfile(fid: number): Promise<Profile> {
        const cacheKey = `warpcast/profile/${fid}`;
        const cached = this.getCacheEntry<Profile>(cacheKey);
        if (cached) return cached;

        const response = await this.makeRequest(`getProfile-${fid}`, () =>
            this.client.get(`/v2/user`, {
                params: { fid }
            })
        );
        elizaLogger.info('Profile response:', JSON.stringify(response.data, null, 2));

        const user = response.data.result.user;
        const extras = response.data.result.extras;

        const profile: Profile = {
            fid,
            name: user.displayName || "",
            username: user.username,
            bio: user.profile?.bio?.text || "",
            pfp: user.pfp?.url,
            address: extras.custodyAddress,
        };

        this.setCacheEntry(cacheKey, profile);
        return profile;
    }

    async getVerifications(fid: number, limit: number = 25, cursor?: string): Promise<Verification[]> {
        const params = new URLSearchParams();
        params.append('limit', limit.toString());
        params.append('fid', fid.toString());

        const response = await this.makeRequest(`getVerifications-${fid}`, () =>
            this.client.get(`/v2/verifications`, { params })
        );

        const verifications: Verification[] = response.data.result.verifications;

        return verifications;
    }

    async getTimeline(request: { fid: number; pageSize: number }): Promise<{
        timeline: Cast[];
        nextPageToken?: Uint8Array;
    }> {
        const response = await this.makeRequest(`getTimeline-${request.fid}`, () =>
            this.getCastsByFid(request.fid, request.pageSize)
        );
        const timeline: Cast[] = [];

        for (const castResponse of response.casts) {
            const profile = await this.getProfile(castResponse.author.fid);
            const cast: Cast = {
                hash: castResponse.hash,
                authorFid: castResponse.author.fid,
                text: castResponse.text,
                profile,
                ...(castResponse.parentHash ? {
                    inReplyTo: {
                        hash: castResponse.parentHash,
                        fid: castResponse.author.fid,
                    },
                } : {}),
                timestamp: new Date(castResponse.timestamp),
            };
            timeline.push(cast);
        }

        return { timeline };
    }

    private handleError(error: unknown): WarpcastError {
        const warpcastError = new Error(
            axios.isAxiosError(error) && error.response?.data?.message
                ? error.response.data.message
                : error instanceof Error
                    ? error.message
                    : String(error)
        ) as WarpcastError;

        if (axios.isAxiosError(error)) {
            warpcastError.status = error.response?.status;
            warpcastError.code = error.response?.data?.code;
            warpcastError.details = error.response?.data;
        }

        return warpcastError;
    }
}