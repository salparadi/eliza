import {
    composeContext,
    elizaLogger,
    generateMessageResponse,
    generateShouldRespond,
    Memory,
    ModelClass,
    stringToUuid,
    HandlerCallback,
    Content,
    type IAgentRuntime,
} from "@ai16z/eliza";
import type { WarpcastClient } from "./client";
import { toHex } from "viem";
import { buildConversationThread, createCastMemory } from "./memory";
import { Cast, Profile } from "./types";
import {
    formatCast,
    formatTimeline,
    messageHandlerTemplate,
    shouldRespondTemplate,
} from "./prompts";
import { castUuid } from "./utils";
import { sendCast } from "./actions";

export class WarpcastInteractionManager {
    private timeout: NodeJS.Timeout | undefined;

    constructor(
        public client: WarpcastClient,
        public runtime: IAgentRuntime,
        public cache: Map<string, any>
    ) {}

    public async start() {
        const handleInteractionsLoop = async () => {
            try {
                await this.handleInteractions();
            } catch (error) {
                console.error(error);
                return;
            }

            this.timeout = setTimeout(
                handleInteractionsLoop,
                Number(
                    this.runtime.getSetting("WARPCAST_POLL_INTERVAL") || 120
                ) * 1000 // Default to 2 minutes
            );
        };

        handleInteractionsLoop();
    }

    public async stop() {
        if (this.timeout) clearTimeout(this.timeout);
    }

    private async handleInteractions() {
        elizaLogger.log("Checking Warpcast interactions at " + new Date().toISOString());

        const agentFid = Number(this.runtime.getSetting("WARPCAST_FID"));

        try {
            const { casts } = await this.client.getNotifications(10);
            elizaLogger.info(`Found ${casts.length} relevant casts (replies/mentions)`);

            const agent = await this.client.getUserByFid(agentFid);
            const agentProfile = {
                fid: agent.fid,
                name: agent.displayName,
                username: agent.username,
                bio: agent.profile.bio.text,
                pfp: agent.pfp.url,
            };

            for (const cast of casts) {
                elizaLogger.info(`Processing cast ${cast.hash} from @${cast.profile.username}: ${cast.text}`);

                const conversationId = `${cast.hash}-${this.runtime.agentId}`;
                const roomId = stringToUuid(conversationId);
                const userId = stringToUuid(cast.authorFid.toString());

                const pastMemoryId = castUuid({
                    agentId: this.runtime.agentId,
                    hash: cast.hash,
                });

                elizaLogger.info(`Checking for past memory with ID: ${pastMemoryId}`);
                const pastMemory = await this.runtime.messageManager.getMemoryById(pastMemoryId);

                if (pastMemory) {
                    elizaLogger.info(`Found existing memory for cast ${cast.hash}:`, {
                        memoryId: pastMemory.id,
                        content: pastMemory.content,
                        userId: pastMemory.userId,
                        roomId: pastMemory.roomId
                    });
                    continue;
                }

                elizaLogger.info(`No existing memory found for cast ${cast.hash}, proceeding with processing`);

                await this.runtime.ensureConnection(
                    userId,
                    roomId,
                    cast.profile.username,
                    cast.profile.name,
                    "warpcast"
                );

                const thread = await buildConversationThread({
                    client: this.client,
                    runtime: this.runtime,
                    cast,
                });

                const memory: Memory = {
                    content: { text: cast.text, hash: cast.hash },
                    agentId: this.runtime.agentId,
                    userId,
                    roomId,
                };

                await this.handleCast({
                    agent: agentProfile,
                    cast,
                    memory,
                    thread
                });
            }
        } catch (error) {
            elizaLogger.error("Error in handleInteractions:", error);
            throw error;
        }

        this.client.lastInteractionTimestamp = new Date();
    }

    private async handleCast({
        agent,
        cast,
        memory,
        thread
    }: {
        agent: Profile;
        cast: Cast;
        memory: Memory;
        thread: Cast[];
    }) {
        if (cast.profile.fid === agent.fid) {
            elizaLogger.info("skipping cast from bot itself", cast.hash);
            return;
        }

        if (!memory.content.text) {
            elizaLogger.info("skipping cast with no text", cast.hash);
            return { text: "", action: "IGNORE" };
        }

        const currentPost = formatCast(cast);

        const { timeline } = await this.client.getTimeline({
            fid: agent.fid,
            pageSize: 10,
        });

        const formattedTimeline = formatTimeline(
            this.runtime.character,
            timeline
        );

        const formattedConversation = thread
            .map(
                (cast) => `@${cast.profile.username} (${new Date(
                    cast.timestamp
                ).toLocaleString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                    month: "short",
                    day: "numeric",
                })}):
                ${cast.text}`
            )
            .join("\n\n");

        const state = await this.runtime.composeState(memory, {
            warpcastUsername: agent.username,
            timeline: formattedTimeline,
            currentPost,
            formattedConversation,
        });

        const shouldRespondContext = composeContext({
            state,
            template:
                this.runtime.character.templates
                    ?.warpcastShouldRespondTemplate ||
                this.runtime.character?.templates?.shouldRespondTemplate ||
                shouldRespondTemplate,
        });

        elizaLogger.info("=== Should Respond Context ===\n", JSON.stringify(shouldRespondContext, null, 2));

        const shouldRespondResponse = await generateShouldRespond({
            runtime: this.runtime,
            context: shouldRespondContext,
            modelClass: ModelClass.SMALL,
        });

        elizaLogger.info('=== LLM Response to ShouldRespond ===');
        elizaLogger.info('Raw response:', JSON.stringify(shouldRespondResponse, null, 2));

        if (
            shouldRespondResponse === "IGNORE" ||
            shouldRespondResponse === "STOP"
        ) {
            elizaLogger.info(
                `Not responding to cast ${cast.hash} because generated ShouldRespond was ${shouldRespondResponse}`
            );
            return;
        }

        const memoryId = castUuid({
            agentId: this.runtime.agentId,
            hash: cast.hash,
        });

        const castMemory = await this.runtime.messageManager.getMemoryById(memoryId);

        if (!castMemory) {
            await this.runtime.messageManager.createMemory(
                createCastMemory({
                    roomId: memory.roomId,
                    runtime: this.runtime,
                    cast,
                })
            );
        }

        const context = composeContext({
            state,
            template:
                this.runtime.character.templates
                    ?.warpcastMessageHandlerTemplate ??
                this.runtime.character?.templates?.messageHandlerTemplate ??
                messageHandlerTemplate,
        });

        const responseContent = await generateMessageResponse({
            runtime: this.runtime,
            context,
            modelClass: ModelClass.LARGE,
        });

        elizaLogger.info('=== LLM Response to MessageResponse ===');
        elizaLogger.info('Raw response:', JSON.stringify(responseContent, null, 2));
        elizaLogger.info('Action:', responseContent.action);
        elizaLogger.info('Text:', responseContent.text);

        responseContent.inReplyTo = memoryId;

        if (!responseContent.text) return;

        if (this.runtime.getSetting("WARPCAST_DRY_RUN") === "true") {
            elizaLogger.info(
                `Dry run: would have responded to cast ${cast.hash} with ${responseContent.text}`
            );
            return;
        }

        const callback: HandlerCallback = async (
            content: Content,
            files: any[]
        ) => {
            try {
                if (memoryId && !content.inReplyTo) {
                    content.inReplyTo = memoryId;
                }

                if (content.text && content.text.length > 280) {
                    content.text = content.text.slice(0, 277) + "...";
                }

                const results = await sendCast({
                    runtime: this.runtime,
                    client: this.client,
                    profile: cast.profile,
                    content: content,
                    roomId: memory.roomId,
                    inReplyTo: {
                        fid: cast.authorFid,
                        hash: cast.hash,
                    },
                });

                results[0].memory.content.action = content.action;

                for (const { memory } of results) {
                    await this.runtime.messageManager.createMemory(memory);
                }
                return results.map((result) => result.memory);
            } catch (error: any) {
                console.error('Error sending response cast:', error);
                return [];
            }
        };

        const responseMessages = await callback(responseContent);

        const newState = await this.runtime.updateRecentMessageState(state);

        const actionMemory: Memory = {
            content: {
                text: responseContent.text,
                action: responseContent.action,
                reason: responseContent.reason,
                castHash: cast.hash,
                castAuthorFID: cast.authorFid
            },
            agentId: this.runtime.agentId,
            userId: memory.userId,
            roomId: memory.roomId
        };

        await this.runtime.processActions(
            actionMemory,
            responseMessages,
            newState,
            callback
        );
    }
}