import {
    composeContext,
    generateText,
    IAgentRuntime,
    ModelClass,
    stringToUuid,
    elizaLogger,
    UUID
} from "@elizaos/core";
import { WarpcastClient } from "./client";
import { formatTimeline, postTemplate } from "./prompts";
import { castUuid, sendCast } from "./utils";
import { createCastMemory } from "./memory";
import type { Profile } from "./types";

export class WarpcastPostManager {
    private timeout: NodeJS.Timeout | undefined;

    constructor(
        public client: WarpcastClient,
        public runtime: IAgentRuntime,
        public cache: Map<string, any>
    ) {}

    public async start() {
        const generateNewCastLoop = async () => {
            try {
                await this.generateNewCast();
            } catch (error) {
                elizaLogger.error('Error in generateNewCastLoop:', error);
            }

            // Schedule next run
            this.timeout = setTimeout(
                generateNewCastLoop,
                this.getRandomPostInterval()
            );
        };

        generateNewCastLoop();
    }

    public async stop() {
        if (this.timeout) clearTimeout(this.timeout);
    }

    private getRandomPostInterval(): number {
        const minInterval = Number(this.runtime.getSetting('POST_INTERVAL_MIN') || 90);
        const maxInterval = Number(this.runtime.getSetting('POST_INTERVAL_MAX') || 180);

        const randomMinutes = Math.floor(
            Math.random() * (maxInterval - minInterval + 1)
        ) + minInterval;

        return randomMinutes * 60 * 1000; // Convert to milliseconds
    }

    private async ensureAgentSetup(profile: Profile) {
        await this.runtime.ensureUserExists(
            this.runtime.agentId,
            profile.username,
            this.runtime.character.name,
            "warpcast"
        );
    }

    private async getTimelineContext(fid: number) {
        const { timeline } = await this.client.getTimeline({
            fid,
            pageSize: 10,
        });

        this.cache.set("warpcast/timeline", timeline);

        return formatTimeline(
            this.runtime.character,
            timeline
        );
    }

    private trimContent(content: string, maxLength: number = 280): string {
        let trimmed = content.replaceAll(/\\n/g, "\n").trim();

        // First try to trim at a newline if too long
        if (trimmed.length > maxLength) {
            const newlineTrimmed = trimmed.slice(0, trimmed.lastIndexOf("\n"));
            if (newlineTrimmed.length > 0) {
                trimmed = newlineTrimmed;
            }
        }

        // If still too long or no newline found, trim at last period
        if (trimmed.length > maxLength) {
            const periodTrimmed = trimmed.slice(0, trimmed.lastIndexOf(".") + 1);
            if (periodTrimmed.length > 0) {
                trimmed = periodTrimmed;
            }
        }

        // Final fallback: hard cut at maxLength
        if (trimmed.length > maxLength) {
            trimmed = trimmed.slice(0, maxLength);
        }

        return trimmed;
    }

    private async generateNewCast() {
        elizaLogger.info("Generating new cast");

        try {
            const fid = Number(this.runtime.getSetting("WARPCAST_FID")!);
            const profile = await this.client.getProfile(fid);

            await this.ensureAgentSetup(profile);
            const formattedHomeTimeline = await this.getTimelineContext(fid);

            const generateRoomId = stringToUuid("warpcast_generate_room") as UUID;
            const topics = this.runtime.character.topics.join(", ");

            const state = await this.runtime.composeState(
                {
                    roomId: generateRoomId,
                    userId: this.runtime.agentId,
                    agentId: this.runtime.agentId,
                    content: {
                        text: topics || '',
                        action: ""
                    },
                },
                {
                    warpcastUserName: profile.username,
                    timeline: formattedHomeTimeline
                }
            );

            const context = composeContext({
                state,
                template:
                    this.runtime.character.templates?.warpcastPostTemplate ||
                    postTemplate,
            });

            const newContent = await generateText({
                runtime: this.runtime,
                context,
                modelClass: ModelClass.LARGE,
            });

            elizaLogger.info("New cast text generated:", newContent);

            const content = this.trimContent(newContent);

            if (this.runtime.getSetting("WARPCAST_DRY_RUN") === "true") {
                elizaLogger.info(`Dry run: would have cast: ${content}`);
                return;
            }

            await this.publishCast(content, generateRoomId, profile);

        } catch (error) {
            elizaLogger.error("Error generating new cast:", error);
            throw error; // Re-throw to be handled by the loop
        }
    }

    private async publishCast(content: string, generateRoomId: UUID, profile: Profile) {
        try {
            const [{ cast }] = await sendCast({
                client: this.client,
                runtime: this.runtime,
                roomId: generateRoomId,
                content: { text: content },
                profile,
            });

            const roomId = castUuid({
                agentId: this.runtime.agentId,
                hash: cast.hash,
            }) as UUID;

            await this.runtime.ensureRoomExists(roomId);
            await this.runtime.ensureParticipantInRoom(
                this.runtime.agentId,
                roomId
            );

            await this.runtime.messageManager.createMemory(
                createCastMemory({
                    roomId,
                    runtime: this.runtime,
                    cast,
                })
            );
        } catch (error) {
            elizaLogger.error("Error publishing cast:", error);
            throw error;
        }
    }
}