import { Action, IAgentRuntime, Memory, State, elizaLogger } from '@elizaos/core'
import { WarpcastAgentClient } from '@elizaos/client-warpcast'
import { TokenService } from '../services/TokenService'
import { TipService } from '../services/TipService'

export enum TipReason {
    HIGH_QUALITY = 'HIGH_QUALITY',
    POTENTIAL_VIRALITY = 'POTENTIAL_VIRALITY',
    HIGH_ENGAGEMENT = 'HIGH_ENGAGEMENT',
    INNOVATIVE_IDEAS = 'INNOVATIVE_IDEAS'
}

interface TipActionContent {
    reason: TipReason;
    castHash: string;
    castAuthorFID: number;
}

const tipService = new TipService();

export const tipAction: Action = {
    name: 'tip',
    description: 'Tips a Farcaster user based on their content quality',
    validate: async (runtime: IAgentRuntime) => {
        const requiredSettings = [
            'TIP_BASE_AMOUNT',
            'TIP_RPC_URL',
            'TIP_PRIVATE_KEY',
            'TIP_TOKEN_ADDRESS'
        ];

        return requiredSettings.every(setting => {
            const value = runtime.getSetting(setting);
            return value !== undefined && value !== null && value !== '';
        });
    },
    handler: async (runtime: IAgentRuntime, message: Memory, state: State) => {
        elizaLogger.info('=== Tip handler called ===');
        elizaLogger.info('Message:', JSON.stringify(message, null, 2));

        try {
            const { reason, castHash, castAuthorFID } = extractTipContent(message);
            elizaLogger.info('Extracted tip content:', { reason, castHash, castAuthorFID });

            if (!isValidTipContent(reason, castHash, castAuthorFID)) {
                elizaLogger.info('Invalid tip content');
                return false;
            }

            if (!tipService.canTip(castAuthorFID)) {
                elizaLogger.info(`User ${castAuthorFID} has already been tipped today`);
                return false;
            }

            const warpcastClient = Object.values(runtime.clients || {}).find(
                client => client instanceof WarpcastAgentClient
            ) as WarpcastAgentClient | undefined;

            if (!warpcastClient?.client) {
                elizaLogger.error('No WarpcastAgentClient found in runtime');
                return false;
            }

            const client = warpcastClient.client;
            elizaLogger.info('Using existing WarpcastClient instance');

            // Get the user profile directly instead of looking for cast data
            const profile = await client.getProfile(castAuthorFID);
            const verifications = await client.getVerifications(castAuthorFID);

            if (!profile) {
                elizaLogger.error('Could not fetch profile for FID:', castAuthorFID);
                return false;
            }
            if (!verifications) {
                elizaLogger.error('Could not fetch verifications for FID:', castAuthorFID);
                return false;
            }

            // Safely get verified address with null check
            const verifiedAddress = verifications
                ?.filter(v => v.protocol === 'ethereum')
                .sort((a, b) => a.timestamp - b.timestamp)[0]?.address;

            if (verifiedAddress) {
                elizaLogger.info('Found verified address:', verifiedAddress);
            }

            // Fallback to custody address if no verified address is found
            const custodyAddress = profile.address;
            if (!verifiedAddress && custodyAddress) {
                elizaLogger.info('Using custody address:', custodyAddress);
            }

            const recipientAddress = verifiedAddress || custodyAddress;
            if (!recipientAddress) {
                elizaLogger.error('Could not find any valid ETH address for FID');
                return false;
            }

            const tokenService = await TokenService.create(runtime);
            const baseAmount = runtime.getSetting('TIP_BASE_AMOUNT');

            elizaLogger.info('Initiating tip using configured amount:', baseAmount);

            if (runtime.getSetting("WARPCAST_DRY_RUN") === "true") {
                elizaLogger.info(
                    `Dry run: would have tipped: ${baseAmount} to ${recipientAddress}`
                );
                return true;
            }

            const txHash = await tokenService.sendTip(recipientAddress, baseAmount);

            // Simple confirmation reply to the cast
            await client.publishCast({
                text: `Tip sent! https://basescan.org/tx/${txHash}`,
                parent: {
                    hash: castHash,
                    fid: castAuthorFID
                }
            });

            tipService.recordTip(castAuthorFID);
            elizaLogger.info('Tip sent successfully:', txHash);

            return true;
        } catch (error) {
            elizaLogger.error('Error in tip handler:', error);
            return false;
        }
    },
    examples: [
        [{
            user: "assistant",
            content: {
                text: "Great analysis! Sending a tip for the quality content.",
                action: "tip",
                castHash: "0x123",
                reason: "HIGH_QUALITY"
            }
        }]
    ],
    similes: ['reward', 'send_tip']
}

function extractTipContent(message: Memory): TipActionContent {
    const actionContent = message.content?.content || message.content;
    return {
        reason: (actionContent as any)?.reason,
        castHash: (actionContent as any)?.castHash,
        castAuthorFID: (actionContent as any)?.castAuthorFID
    };
}

function isValidTipContent(reason: TipReason, castHash: string, castAuthorFID: number): boolean {
    if (!castHash || !reason || !castAuthorFID || !Object.values(TipReason).includes(reason)) {
        elizaLogger.error('Missing or invalid tip parameters:', { castHash, reason, castAuthorFID });
        return false;
    }
    return true;
}