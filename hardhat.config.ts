import { config as dotenvConfig } from 'dotenv';
import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import 'hardhat-finder';
import 'solidity-docgen';
import 'solidity-coverage';
import 'hardhat-contract-sizer';
import './tasks';
import { EventEmitter } from 'events';
import '@openzeppelin/hardhat-upgrades';

import '@matterlabs/hardhat-zksync';
import '@matterlabs/hardhat-zksync-upgradable';
import { resolve } from 'path';

dotenvConfig({ path: resolve(__dirname, './.env') });

EventEmitter.defaultMaxListeners = 50;

function getWallet() {
  return process.env.DEPLOYER_WALLET_PRIVATE_KEY !== undefined
    ? [process.env.DEPLOYER_WALLET_PRIVATE_KEY]
    : [];
}

const config: HardhatUserConfig = {
  solidity: {
    eraVersion: '1.0.1',
    compilers: [
      {
        version: process.env.SOLC_VERSION || '0.8.28',
        settings: { optimizer: { enabled: true, runs: 100 } },
      },
      {
        version: '0.8.20',
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
    ],
  },
  finder: {
    prettify: true,
  },
  docgen: {
    outputDir: './docs',
  },
  contractSizer: {
    runOnCompile: false,
    strict: true,
  },
  gasReporter: {
    enabled:
      (process.env.REPORT_GAS &&
        'true' === process.env.REPORT_GAS.toLowerCase()) ||
      false,
    coinmarketcap: process.env.COINMARKETCAP_API_KEY || '',
    gasPriceApi:
      process.env.GAS_PRICE_API ||
      'https://api.etherscan.io/api?module=proxy&action=eth_gasPrice',
    token: 'ETH',
    currency: 'USD',
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize:
        (process.env.ALLOW_UNLIMITED_CONTRACT_SIZE &&
          'true' === process.env.ALLOW_UNLIMITED_CONTRACT_SIZE.toLowerCase()) ||
        false,
    },
    localhost: {
      url: 'http://localhost:8545',
      //zksync: true,
      ethNetwork: 'http://localhost:8545',
      accounts: getWallet(),
    },
    custom: {
      url: process.env.CUSTOM_NETWORK_URL || '',
      accounts: {
        count:
          (process.env.CUSTOM_NETWORK_ACCOUNTS_COUNT &&
            Boolean(parseInt(process.env.CUSTOM_NETWORK_ACCOUNTS_COUNT)) &&
            parseInt(process.env.CUSTOM_NETWORK_ACCOUNTS_COUNT)) ||
          0,
        mnemonic: process.env.CUSTOM_NETWORK_ACCOUNTS_MNEMONIC || '',
        path: process.env.CUSTOM_NETWORK_ACCOUNTS_PATH || '',
      },
    },
    arbitrumTestnet: {
      url: process.env.ARBITRUM_TESTNET_RPC_URL || '',
      accounts: getWallet(),
    },
    auroraTestnet: {
      url: process.env.AURORA_TESTNET_RPC_URL || '',
      accounts: getWallet(),
    },
    avalancheFujiTestnet: {
      url: process.env.AVALANCHE_FUJI_TESTNET_RPC_URL || '',
      accounts: getWallet(),
    },
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC_URL || '',
      accounts: getWallet(),
    },
    ftmTestnet: {
      url: process.env.FTM_TESTNET_RPC_URL || '',
      accounts: getWallet(),
    },
    goerli: {
      url: process.env.GOERLI_RPC_URL || '',
      accounts: getWallet(),
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || '',
      accounts: getWallet(),
    },
    harmonyTest: {
      url: process.env.HARMONY_TEST_RPC_URL || '',
      accounts: getWallet(),
    },
    hecoTestnet: {
      url: process.env.HECO_TESTNET_RPC_URL || '',
      accounts: getWallet(),
    },
    moonbaseAlpha: {
      url: process.env.MOONBASE_ALPHA_RPC_URL || '',
      accounts: getWallet(),
    },
    polygonMumbai: {
      url: process.env.POLYGON_MUMBAI_RPC_URL || '',
      accounts: getWallet(),
    },
    sokol: {
      url: process.env.SOKOL_RPC_URL || '',
      accounts: getWallet(),
    },
    flare: {
      url: 'https://flare-api.flare.network/ext/bc/C/rpc',
      accounts: getWallet(),
    },
    morph: {
      url: 'https://rpc-quicknode.morphl2.io',
      chainId: 2818,
      accounts: getWallet(),
    },
    celo: {
      url: 'https://forno.celo.org',
      accounts: getWallet(),
    },
    sophonTestnet: {
      url: 'https://rpc.testnet.sophon.xyz',
      ethNetwork: 'sepolia',
      chainId: 531050104,
      zksync: true,
      verifyURL:
        'https://verification-explorer.sophon.xyz/contract_verification',
      browserVerifyURL: 'https://explorer.sophon.xyz/',
      enableVerifyURL: true,
      accounts: getWallet(),
    },
    sophon: {
      url: 'https://rpc.sophon.xyz',
      chainId: 50104,
      ethNetwork: 'mainnet',
      zksync: true,
      enableVerifyURL: true,
      browserVerifyURL: 'https://explorer.sophon.xyz/',
      verifyURL:
        'https://verification-explorer.sophon.xyz/contract_verification',
      accounts: getWallet(),
    },
    zksync: {
      url: 'https://mainnet.era.zksync.io',
      ethNetwork: 'mainnet',
      zksync: true,
      verifyURL:
        'https://block-explorer-api.mainnet.zksync.io/contract_verification',
      accounts: getWallet(),
    },
    linea: {
      url: 'https://rpc.linea.build',
      chainId: 59144,
      accounts: getWallet(),
    },
    mainnet: {
      url: process.env.ETHEREUM_MAINNET_RPC_URL || '',
      accounts: getWallet(),
    },
    base: {
      url: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
      chainId: 8453,
      accounts: getWallet(),
    },
    citrea: {
      url: process.env.CITREA_RPC_URL || 'https://rpc.mainnet.citrea.xyz',
      chainId: 4114,
      accounts: getWallet(),
    },
    berachain: {
      url:
        process.env.BERACHAIN_RPC_URL || 'https://berachain-rpc.publicnode.com',
      chainId: 80094,
      accounts: getWallet(),
    },
  },

  etherscan: {
    enabled: true,
    // Etherscan V2: a single API key covers every Etherscan-family chain
    // (mainnet, sepolia, base, berachain, arbitrum, polygon, ...).
    // Non-Etherscan explorers (Blockscout: flare/morph/celo, zkSync verifier,
    // citrea) resolve via `customChains` below and do not consume this key.
    apiKey: process.env.ETHERSCAN_API_KEY || '',
    customChains: [
      {
        network: 'custom',
        chainId:
          (process.env.CUSTOM_NETWORK_CHAIN_ID &&
            Boolean(parseInt(process.env.CUSTOM_NETWORK_CHAIN_ID)) &&
            parseInt(process.env.CUSTOM_NETWORK_CHAIN_ID)) ||
          0,
        urls: {
          apiURL: process.env.CUSTOM_NETWORK_API_URL || '',
          browserURL: process.env.CUSTOM_NETWORK_BROWSER_URL || '',
        },
      },
      {
        network: 'flare',
        chainId: 14,
        urls: {
          apiURL: 'https://flare-explorer.flare.network/api',
          browserURL: 'https://flare-explorer.flare.network',
        },
      },
      {
        network: 'morph',
        chainId: 2818,
        urls: {
          apiURL: 'https://explorer.morphl2.io/api',
          browserURL: 'https://explorer.morphl2.io',
        },
      },
      {
        network: 'celo',
        chainId: 42220,
        urls: {
          apiURL: 'https://explorer.celo.org/api',
          browserURL: 'https://explorer.celo.org',
        },
      },
      {
        network: 'sophonTestnet',
        chainId: 531050104,
        urls: {
          apiURL: 'https://api-testnet.sophscan.xyz/api',
          browserURL: 'https://testnet.sophscan.xyz',
        },
      },
      {
        network: 'sophon',
        chainId: 50104,
        urls: {
          apiURL: 'https://api.sophscan.xyz/api',
          browserURL: 'https://sophscan.xyz',
        },
      },
      {
        network: 'linea',
        chainId: 59144,
        urls: {
          apiURL: 'https://api.lineascan.build/api',
          browserURL: 'https://lineascan.build',
        },
      },
      {
        network: 'zksync',
        chainId: 324,
        urls: {
          apiURL: 'https://block-explorer-api.mainnet.zksync.io/api',
          browserURL: 'https://explorer.zksync.io',
        },
      },
      {
        network: 'citrea',
        chainId: 4114,
        urls: {
          apiURL: 'https://explorer.mainnet.citrea.xyz/api',
          browserURL: 'https://explorer.mainnet.citrea.xyz',
        },
      },
      {
        network: 'berachain',
        chainId: 80094,
        urls: {
          apiURL: 'https://api.etherscan.io/v2/api?chainid=80094',
          browserURL: 'https://berascan.com',
        },
      },
    ],
  },
  sourcify: {
    // Sourcify's v1 API is in an extended brownout — disable so verification
    // doesn't spam a 503 alongside Etherscan.
    enabled: false,
  },
  zksolc: {
    version: '1.5.7',
    compilerSource: 'binary',
    settings: {
      libraries: {},
      missingLibrariesPath:
        './.zksolc-libraries-cache/missingLibraryDependencies.json',
      enableEraVMExtensions: false,
      forceEVMLA: false,
      optimizer: {
        enabled: true,
        mode: '3',
        fallback_to_optimizing_for_size: false,
      },
      experimental: {
        dockerImage: '',
        tag: '',
      },
    },
  },
};

export default config;
