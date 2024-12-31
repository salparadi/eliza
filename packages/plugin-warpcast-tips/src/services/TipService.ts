export class TipService {
    private tipCache: Map<number, Date> = new Map();

    canTip(fid: number): boolean {
        const lastTipDate = this.tipCache.get(fid);
        if (!lastTipDate) return true;

        const now = new Date();
        const today = now.toDateString();
        const lastTipDay = lastTipDate.toDateString();

        return today !== lastTipDay;
    }

    recordTip(fid: number): void {
        this.tipCache.set(fid, new Date());
    }

    clearCache(): void {
        this.tipCache.clear();
    }
}