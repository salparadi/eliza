import {
    composeContext,
    generateText,
    IAgentRuntime,
    ModelClass,
    stringToUuid,
    elizaLogger
} from "@ai16z/eliza";
import { WarpcastClient } from "./client";
import { formatTimeline, postTemplate } from "./prompts";
import { castUuid } from "./utils";
import { createCastMemory } from "./memory";
import { sendCast } from "./actions";

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
                elizaLogger.error(error);
                return;
            }

            this.timeout = setTimeout(
                generateNewCastLoop,
                (Math.floor(Math.random() * (4 - 1 + 1)) + 1) * 60 * 60 * 1000
            ); // Random interval between 1 and 4 hours
        };

        generateNewCastLoop();
    }

    public async stop() {
        if (this.timeout) clearTimeout(this.timeout);
    }

    private async generateNewCast() {
        elizaLogger.info("Generating new cast");

        try {
            const fid = Number(this.runtime.getSetting("WARPCAST_FID")!);
            const profile = await this.client.getProfile(fid);

            await this.runtime.ensureUserExists(
                this.runtime.agentId,
                profile.username,
                this.runtime.character.name,
                "warpcast"
            );

            const { timeline } = await this.client.getTimeline({
                fid,
                pageSize: 10,
            });

            this.cache.set("warpcast/timeline", timeline);

            const formattedHomeTimeline = formatTimeline(
                this.runtime.character,
                timeline
            );

            const generateRoomId = stringToUuid("warpcast_generate_room");

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

            //elizaLogger.info("State:", state);

            const context = composeContext({
                state,
                template:
                    this.runtime.character.templates?.warpcastPostTemplate ||
                    postTemplate,
            });

            //elizaLogger.info("Context:", context);

            const newContent = await generateText({
                runtime: this.runtime,
                context,
                modelClass: ModelClass.LARGE,
            });

            elizaLogger.info("New cast text generated:", newContent);

            const slice = newContent.replaceAll(/\\n/g, "\n").trim();
            const contentLength = 280;
            let content = slice;

            // First try to trim at a newline if too long
            if (content.length > contentLength) {
                content = content.slice(0, content.lastIndexOf("\n"));
            }

            // If still too long or no newline found, trim at last period
            if (content.length > contentLength) {
                content = content.slice(0, content.lastIndexOf(".") + 1);
            }

            // Final fallback: hard cut at contentLength
            if (content.length > contentLength) {
                content = content.slice(0, contentLength);
            }

            if (this.runtime.getSetting("WARPCAST_DRY_RUN") === "true") {
                elizaLogger.info(
                    `Dry run: would have cast: ${content}`
                );
                return;
            }

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
                });

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
                elizaLogger.error("Error sending cast:", error);
            }
        } catch (error) {
            elizaLogger.error("Error generating new cast:", error);
        }
    }
}