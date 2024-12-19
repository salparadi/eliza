import { ethers } from 'ethers';
import { IAgentRuntime, elizaLogger } from '@ai16z/eliza';

export class TokenService {
    private readonly ERC20_ABI = [
        "function transfer(address to, uint256 amount) returns (bool)",
        "function balanceOf(address owner) view returns (uint256)",
        "function decimals() view returns (uint8)",
        "function symbol() view returns (string)"
    ];

    constructor(
        private readonly runtime: IAgentRuntime,
        private readonly provider: ethers.JsonRpcProvider,
        private readonly wallet: ethers.Wallet
    ) {}

    static async create(runtime: IAgentRuntime): Promise<TokenService> {
        const provider = new ethers.JsonRpcProvider(runtime.getSetting('TIP_RPC_URL'));
        const privateKey = runtime.getSetting('TIP_PRIVATE_KEY');
        const wallet = new ethers.Wallet(privateKey, provider);

        return new TokenService(runtime, provider, wallet);
    }

    async sendTip(recipientAddress: string, tokenAmount: string): Promise<string> {
        const tokenAddress = this.runtime.getSetting('TIP_TOKEN_ADDRESS');
        const tokenContract = new ethers.Contract(tokenAddress, this.ERC20_ABI, this.wallet);

        // Get token info
        const decimals = await tokenContract.decimals();
        const symbol = await tokenContract.symbol();

        // Format the amount with the correct number of decimals
        const parsedAmount = ethers.parseUnits(tokenAmount, decimals);
        elizaLogger.info(`Sending ${tokenAmount} ${symbol} (${parsedAmount.toString()} wei)`);

        // Check balance before sending
        const balance = await tokenContract.balanceOf(this.wallet.address);
        const formattedBalance = ethers.formatUnits(balance, decimals);
        elizaLogger.info(`Current balance: ${formattedBalance} ${symbol}`);

        if (balance < parsedAmount) {
            throw new Error(`Insufficient token balance. Have: ${formattedBalance} ${symbol}, Need: ${tokenAmount} ${symbol}`);
        }

        const tx = await tokenContract.transfer(recipientAddress, parsedAmount);
        const receipt = await tx.wait();

        return tx.hash;
    }
}