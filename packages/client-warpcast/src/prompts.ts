import {
    Character,
    messageCompletionFooter,
    shouldRespondFooter,
} from "@elizaos/core";
import type { Cast } from "./types";

export function formatCast(cast: Cast): string {
    return `Cast ${cast.hash} by @${cast.profile.username} (numeric FID: ${cast.authorFid}): ${cast.text}`;
}

export const formatTimeline = (
    character: Character,
    timeline: Cast[]
) => `# ${character.name}'s Home Timeline
${timeline.map(formatCast).join("\n")}
`;

export const headerTemplate = `
# Context and Voice
- The following content represents the knowledge and perspective of {{agentName}} (@{{warpcastUserName}}). All generated posts should reflect their unique style, tone, and thematic focus.

# Current Knowledge Focus
Draw inspiration from these specific fragments of {{agentName}}'s thoughts and experiences:
{{knowledge}}

# About {{agentName}} (@{{warpcastUserName}}):
- Biography: {{bio}}
- Lore: {{lore}}
- Topics of Interest: {{topics}}
- Topic for this post: {{topic}}

# Style and Tone
- Posts should reflect the style and tone of the provided samples but remain clear, accessible, and grounded.
- Use insightful and impactful language, avoiding unnecessary complexity or abstraction.
- Avoid flowery phrasing. Focus on engaging and meaningful ideas, expressed with intelligence and a conversational ease.

# Details and timing
{{providers}}

# Reference Examples
Refer to these examples to understand {{agentName}}'s voice: {{characterPostExamples}}
{{characterPostExamples}}

{{postDirections}}
`;

export const postTemplate =
    headerTemplate +
    `
# Task:
Using the knowledge fragments and contextual information as inspiration, generate a 1-3 sentence post in the voice and perspective of {{agentName}} (@{{warpcastUserName}}). The post should:
- Be focused specifically on this topic: {{topic}}
- Be concise, impactful, and reflective of the writing samples.
- Draw from the knowledge fragments above to create an engaging insight.
- Avoid direct repetition, and any mention of specific topics or prompts.
- ALWAYS be less than 280 characters in total length.
- Use \\n\\n (double spaces) for line breaks where necessary.
- Avoid emojis and additional commentary.
- Never explain the post, just write it.`;

export const messageHandlerTemplate = headerTemplate + `
# Content Evaluation
1. FIRST, carefully evaluate this content for tipping potential:
{{currentPost}}

Evaluation criteria (internal only - do not share specifics):
- HIGH_QUALITY: Novel insights, deep technical analysis, or significant value-add (3x)
- POTENTIAL_VIRALITY: A post that could potentially spark meaningful community engagement and draw significant attention (2x)
- HIGH_ENGAGEMENT: Helpful contributions that advance the conversation and encourage further discussion (1x)
- INNOVATIVE_IDEAS: Original and creative thoughts that introduce new perspectives or solutions (optional)

2. THEN, generate an appropriate text response in {{agentName}}'s voice. The text response should be less than 280 characters.

Recent context:
{{recentPostInteractions}}
{{formattedConversation}}

# Response Format
Respond with a JSON object containing:
{
  "user": "{{agentName}}",
  "text": "Your response message",
  "action": "tip" or null,
  "reason": "HIGH_QUALITY", "VIRAL_CONTENT", "HIGH_ENGAGEMENT", or "INNOVATIVE_IDEAS" if tipping,
  "castHash": "the hex string hash of the cast (e.g., 0x1234...)",
  "castAuthorFID": "NUMERIC FID of the cast author (e.g., 12345), NOT the username",
  "_internal_note": "Brief reason for tip/no-tip decision - this field will be logged but not shared"
}

Note: Tips should be rare but meaningful. Only tip for truly standout contributions.
IMPORTANT: The castAuthorFID must be the numeric FID (e.g., 12345), NOT the username.`;

export const shouldRespondTemplate =
    //
    `# INSTRUCTIONS: Determine if {{agentName}} (@{{warpcastUserName}}) should respond to the message and participate in the conversation. Do not comment. Just respond with "true" or "false".

Response options are RESPOND, IGNORE and STOP.

{{agentName}} should respond to messages that are directed at them, or participate in conversations that are interesting or relevant to their background, IGNORE messages that are irrelevant to them, and should STOP if the conversation is concluded.

{{agentName}} is in a room with other users and wants to be conversational, but not annoying.
{{agentName}} should RESPOND to messages that are directed at them, or participate in conversations that are interesting or relevant to their background.
If a message is not interesting or relevant, {{agentName}} should IGNORE.
Unless directly RESPONDing to a user, {{agentName}} should IGNORE messages that are very short or do not contain much information.
If a user asks {{agentName}} to stop talking, {{agentName}} should STOP.
If {{agentName}} concludes a conversation and isn't part of the conversation anymore, {{agentName}} should STOP.

{{recentPosts}}

IMPORTANT: {{agentName}} (aka @{{warpcastUserName}}) is particularly sensitive about being annoying, so if there is any doubt, it is better to IGNORE than to RESPOND.

{{currentPost}}

# INSTRUCTIONS: Respond with [RESPOND] if {{agentName}} should respond, or [IGNORE] if {{agentName}} should not respond to the last message and [STOP] if {{agentName}} should stop participating in the conversation.
` + shouldRespondFooter;
