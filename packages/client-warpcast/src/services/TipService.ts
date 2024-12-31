import { elizaLogger } from '@elizaos/core';

export class TipService {
    private tipCache: Map<number, Date> = new Map();

    canTip(fid: number): boolean {
        const lastTipDate = this.tipCache.get(fid);
        if (!lastTipDate) return true;

        const now = new Date();
        const today = now.toDateString();
        const lastTipDay = lastTipDate.toDateString();

        const canTip = today !== lastTipDay;
        if (!canTip) {
            elizaLogger.info(`User ${fid} has already been tipped today`);
        }
        return canTip;
    }

    recordTip(fid: number): void {
        this.tipCache.set(fid, new Date());
        elizaLogger.info(`Recorded tip for user ${fid}`);
    }

    clearCache(): void {
        this.tipCache.clear();
        elizaLogger.info('Cleared tip cache');
    }
}