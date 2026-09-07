export const SEPOLIA_ID = 11155111;
export const CREDITCOIN_TESTNET_ID = 102031;
export const SEPOLIA_CHAIN_KEY = 1;

export const sepolia = {
  id: SEPOLIA_ID,
  name: 'Sepolia',
  nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [import.meta.env.VITE_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com'] },
  },
  blockExplorers: { default: { name: 'Etherscan', url: 'https://sepolia.etherscan.io' } },
};

export const creditcoinTestnet = {
  id: CREDITCOIN_TESTNET_ID,
  name: 'Creditcoin Testnet',
  nativeCurrency: { name: 'Creditcoin', symbol: 'tCTC', decimals: 18 },
  rpcUrls: {
    default: { http: [import.meta.env.VITE_CREDITCOIN_RPC || 'https://rpc.cc3-testnet.creditcoin.network'] },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://creditcoin-testnet.blockscout.com' },
  },
};

export const lockerAddress = import.meta.env.VITE_LOCKER_ADDRESS || '';
export const toxascoreAddress = import.meta.env.VITE_TOXASCORE_ADDRESS || '';

const isAddr = (value) => /^0x[a-fA-F0-9]{40}$/.test(value || '');

export const liveConfigured = isAddr(lockerAddress) && isAddr(toxascoreAddress);

export const explorerTx = (chainId, hash) => {
  if (!hash) return '#';
  if (chainId === CREDITCOIN_TESTNET_ID) {
    return `https://creditcoin-testnet.blockscout.com/tx/${hash}`;
  }
  return `https://sepolia.etherscan.io/tx/${hash}`;
};
