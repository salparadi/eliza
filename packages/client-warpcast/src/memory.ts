import {
    elizaLogger,
    getEmbeddingZeroVector,
    IAgentRuntime,
    stringToUuid,
    type Memory,
    type UUID,
} from "@elizaos/core";
import type { Cast } from "./types";
import { toHex } from "viem";
import { castUuid } from "./utils";
import type { WarpcastClient } from "./client";

export function createCastMemory({
    roomId,
    runtime,
    cast,
    content,
}: {
    roomId: UUID;
    runtime: IAgentRuntime;
    cast: Cast;
    content?: { text: string; action?: string; reason?: string; castHash?: string; castAuthorFID?: number };
}): Memory {
    return {
        id: castUuid({
            hash: cast.hash,
            agentId: runtime.agentId,
        }),
        agentId: runtime.agentId,
        userId: runtime.agentId,
        content: {
            text: content?.text ?? cast.text,
            action: content?.action,
            reason: content?.reason,
            castHash: content?.castHash,
            castAuthorFID: content?.castAuthorFID,
        },
        roomId,
        embedding: getEmbeddingZeroVector(),
    };
}

// Builds a conversation thread from a cast. Since Warpcast doesn't provide a getCast endpoint,
// we need to build the thread manually based on the cast's parent and child hashes.
export async function buildConversationThread({
    cast,
    runtime,
    client,
}: {
    cast: Cast;
    runtime: IAgentRuntime;
    client: WarpcastClient;
}): Promise<Cast[]> {
    const thread: Cast[] = [cast];
    const roomId = castUuid({
        hash: cast.hash,
        agentId: runtime.agentId,
    });

    // Create memory for the current cast
    const memory = await runtime.messageManager.getMemoryById(roomId);
    if (!memory) {
        elizaLogger.log("Creating memory for cast", cast.hash);

        const userId = stringToUuid(cast.profile.username);

        await runtime.ensureConnection(
            userId,
            roomId,
            cast.profile.username,
            cast.profile.name,
            "warpcast"
        );

        await runtime.messageManager.createMemory(
            createCastMemory({
                roomId,
                runtime,
                cast,
            })
        );
    }

    // If this is a reply, add the parent info we have from the notification
    if (cast.inReplyTo) {
        elizaLogger.info(`Adding parent cast ${cast.inReplyTo.hash} to thread`);
        thread.unshift({
            hash: cast.inReplyTo.hash,
            authorFid: cast.inReplyTo.fid,
            text: "[previous message]", // We don't have the text from the notification
            profile: {
                fid: cast.inReplyTo.fid,
                username: "", // We don't have these details from the notification
                name: "",
                bio: "",
            },
            timestamp: new Date(cast.timestamp.getTime() - 1), // Just slightly before the reply
        });
    }

    return thread;
}