import { Action, elizaLogger } from '@elizaos/core';
import { TipReason, TipActionContent } from '../types';
import { TokenService } from '../services/TokenService';
import { TipService } from '../services/TipService';
import { WarpcastClient } from '../client';

const tipService = new TipService();

export const tipAction: Action = {
    name: 'tip',
    description: 'Tips a Farcaster user based on their content quality',
    validate: async (runtime) => {
        if (runtime.getSetting('WARPCAST_TIPS_ENABLED') !== 'true') {
            return false;
        }

        const requiredSettings = [
            'WARPCAST_TIP_AMOUNT',
            'WARPCAST_TIP_RPC_URL',
            'WARPCAST_TIP_PRIVATE_KEY',
            'WARPCAST_TIP_TOKEN_ADDRESS'
        ];

        return requiredSettings.every(setting => {
            const value = runtime.getSetting(setting);
            return value !== undefined && value !== null && value !== '';
        });
    },
    handler: async (runtime, message) => {
        elizaLogger.info('=== Tip handler called ===');

        try {
            const { reason, castHash, castAuthorFID } = extractTipContent(message);
            elizaLogger.info('Extracted tip content:', { reason, castHash, castAuthorFID });

            if (!isValidTipContent(reason, castHash, castAuthorFID)) {
                elizaLogger.info('Invalid tip content');
                return false;
            }

            if (!tipService.canTip(castAuthorFID)) {
                return false;
            }

            const client = runtime.clients?.warpcast?.client as WarpcastClient;
            if (!client) {
                elizaLogger.error('No WarpcastClient found in runtime');
                return false;
            }

            // Get the user profile and verifications
            const [profile, verifications] = await Promise.all([
                client.getProfile(castAuthorFID),
                client.getVerifications(castAuthorFID)
            ]);

            if (!profile) {
                elizaLogger.error('Could not fetch profile for FID:', castAuthorFID);
                return false;
            }

            // Get verified Ethereum address or fallback to custody address
            const verifiedAddress = verifications
                ?.filter(v => v.protocol === 'ethereum')
                .sort((a, b) => a.timestamp - b.timestamp)[0]?.address;

            const recipientAddress = verifiedAddress || profile.address;
            if (!recipientAddress) {
                elizaLogger.error('Could not find any valid ETH address for FID');
                return false;
            }

            const tokenService = await TokenService.create(
                runtime.getSetting('WARPCAST_TIP_RPC_URL')!,
                runtime.getSetting('WARPCAST_TIP_PRIVATE_KEY')!,
                runtime.getSetting('WARPCAST_TIP_TOKEN_ADDRESS')!
            );

            const baseAmount = runtime.getSetting('WARPCAST_TIP_AMOUNT')!;
            elizaLogger.info('Initiating tip using configured amount:', baseAmount);

            if (runtime.getSetting("WARPCAST_DRY_RUN") === "true") {
                elizaLogger.info(
                    `Dry run: would have tipped: ${baseAmount} to ${recipientAddress}`
                );
                return true;
            }

            const txHash = await tokenService.sendTip(recipientAddress, baseAmount);

            // Reply to the cast with confirmation
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

function extractTipContent(message: any): TipActionContent {
    const actionContent = message.content?.content || message.content;
    return {
        reason: actionContent?.reason,
        castHash: actionContent?.castHash,
        castAuthorFID: actionContent?.castAuthorFID
    };
}

function isValidTipContent(reason: TipReason, castHash: string, castAuthorFID: number): boolean {
    if (!castHash || !reason || !castAuthorFID || !Object.values(TipReason).includes(reason)) {
        elizaLogger.error('Missing or invalid tip parameters:', { castHash, reason, castAuthorFID });
        return false;
    }
    return true;
}