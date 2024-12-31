import type { WarpcastClient } from "./client";
import type { Content, IAgentRuntime, Memory, UUID } from "@elizaos/core";
import type { Cast, Profile } from "./types";
import { createCastMemory } from "./memory";
import { splitPostContent } from "./utils";

export async function sendCast({
    client,
    runtime,
    content,
    roomId,
    inReplyTo,
    profile,
}: {
    profile: Profile;
    client: WarpcastClient;
    runtime: IAgentRuntime;
    content: Content;
    roomId: UUID;
    inReplyTo?: {
        fid: number;
        hash: string;
    };
}): Promise<{ memory: Memory; cast: Cast }[]> {
    const chunks = splitPostContent(content.text);
    const sent: Cast[] = [];
    let parentHash = inReplyTo?.hash;
    const channelId = runtime.getSetting("WARPCAST_CHANNEL_ID");

    for (const chunk of chunks) {
        const castResponse = await client.publishCast({
            text: chunk,
            parent: inReplyTo,
            ...(channelId ? { channelId } : {})
        });

        const cast: Cast = {
            hash: castResponse.hash,
            authorFid: castResponse.author.fid,
            text: castResponse.text,
            profile,
            ...(inReplyTo ? {
                inReplyTo: {
                    hash: inReplyTo.hash,
                    fid: inReplyTo.fid,
                },
            } : {}),
            timestamp: new Date(castResponse.timestamp),
        };

        sent.push(cast);
        parentHash = cast.hash;
    }

    return sent.map((cast) => ({
        cast,
        memory: createCastMemory({
            roomId,
            runtime,
            cast,
            content,
        }),
    }));
}