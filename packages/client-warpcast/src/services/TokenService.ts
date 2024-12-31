import { ethers } from 'ethers';
import { elizaLogger } from '@elizaos/core';

export class TokenService {
    private readonly ERC20_ABI = [
        "function transfer(address to, uint256 amount) returns (bool)",
        "function balanceOf(address owner) view returns (uint256)",
        "function decimals() view returns (uint8)",
        "function symbol() view returns (string)"
    ];

    constructor(
        private readonly provider: ethers.JsonRpcProvider,
        private readonly wallet: ethers.Wallet,
        private readonly tokenAddress: string
    ) {}

    static async create(
        rpcUrl: string,
        privateKey: string,
        tokenAddress: string
    ): Promise<TokenService> {
        if (!rpcUrl || !privateKey || !tokenAddress) {
            throw new Error('Missing required configuration for TokenService');
        }

        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const wallet = new ethers.Wallet(privateKey, provider);

        return new TokenService(provider, wallet, tokenAddress);
    }

    async sendTip(recipientAddress: string, tokenAmount: string): Promise<string> {
        const tokenContract = new ethers.Contract(this.tokenAddress, this.ERC20_ABI, this.wallet);

        try {
            // Get token info
            const [decimals, symbol] = await Promise.all([
                tokenContract.decimals(),
                tokenContract.symbol()
            ]);

            // Format the amount with the correct number of decimals
            const parsedAmount = ethers.parseUnits(tokenAmount, decimals);
            elizaLogger.info(`Sending ${tokenAmount} ${symbol} (${parsedAmount.toString()} wei)`);

            // Check balance before sending
            const balance = await tokenContract.balanceOf(this.wallet.address);
            const formattedBalance = ethers.formatUnits(balance, decimals);
            elizaLogger.info(`Current balance: ${formattedBalance} ${symbol}`);

            if (balance < parsedAmount) {
                throw new Error(
                    `Insufficient token balance. Have: ${formattedBalance} ${symbol}, Need: ${tokenAmount} ${symbol}`
                );
            }

            const tx = await tokenContract.transfer(recipientAddress, parsedAmount);
            const receipt = await tx.wait();

            return tx.hash;
        } catch (error) {
            elizaLogger.error('Error sending tip:', error);
            throw error;
        }
    }
}
