/* =========================================================
   wallet.js — Numes multi-chain wallet module
   Foco: Trust Wallet (EVM) + TronLink (TRC20) + LTC watch
   Tokens: ETH, BNB, MATIC, USDT (ERC20/BEP20/TRC20), LTC, TRX
   ========================================================= */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'numes_wallet_state';

  /* ---------- Configuración multi-cadena ---------- */
  const EVM_NETWORKS = {
    1:    { name: 'Ethereum',  symbol: 'ETH',   rpc: 'https://eth.llamarpc.com',          explorer: 'https://etherscan.io' },
    56:   { name: 'BNB Chain', symbol: 'BNB',   rpc: 'https://bsc-dataseed.binance.org',  explorer: 'https://bscscan.com' },
    137:  { name: 'Polygon',   symbol: 'MATIC', rpc: 'https://polygon-rpc.com',           explorer: 'https://polygonscan.com' },
    42161:{ name: 'Arbitrum',  symbol: 'ETH',   rpc: 'https://arb1.arbitrum.io/rpc',      explorer: 'https://arbiscan.io' },
  };

  // Tokens ERC20/BEP20 a consultar para una dirección EVM
  const EVM_TOKENS = [
    { symbol: 'USDT', name: 'Tether (ERC20)', chainId: 1,  address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    { symbol: 'USDT', name: 'Tether (BEP20)', chainId: 56, address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    { symbol: 'USDC', name: 'USD Coin',       chainId: 1,  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    { symbol: 'BUSD', name: 'Binance USD',    chainId: 56, address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', decimals: 18 },
  ];

  // Direcciones TRON
  const TRON_USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // USDT TRC20

  const ERC20_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
  ];

  /* ---------- Estado interno ---------- */
  let state = {
    type: null,          // 'evm' | 'tron' | 'ltc'
    walletType: null,    // 'trust' | 'metamask' | 'tronlink' | 'ltc-watch'
    address: null,
    chainId: null,
    provider: null,      // ethers Web3Provider para EVM
    rawProvider: null,   // EIP-1193
    signer: null,
    tronWeb: null,       // window.tronWeb si TRON
  };

  /* ---------- Pub/Sub ---------- */
  const subs = new Set();
  function on(cb) { subs.add(cb); return () => subs.delete(cb); }
  function emit(ev, data) { subs.forEach((cb) => { try { cb(ev, data); } catch (e) { console.error(e); } }); }

  /* ---------- Detección de providers EVM ---------- */
  function findEvmProvider(walletType) {
    if (typeof window === 'undefined') return null;
    const eth = window.ethereum;
    if (!eth) return null;

    const list = eth.providers && eth.providers.length ? eth.providers : [eth];

    if (walletType === 'trust') {
      // Trust expone window.trustwallet o flag isTrust / isTrustWallet
      if (window.trustwallet?.ethereum) return window.trustwallet.ethereum;
      const trust = list.find((p) => p.isTrust || p.isTrustWallet);
      return trust || null;
    }
    if (walletType === 'metamask') {
      const mm = list.find((p) => p.isMetaMask && !p.isTrust && !p.isTrustWallet && !p.isCoinbaseWallet);
      return mm || (eth.isMetaMask ? eth : null);
    }
    return eth; // injected genérico
  }

  /* ---------- CONNECT principal ---------- */
  async function connect(walletType) {
    try {
      if (walletType === 'trust' || walletType === 'metamask') {
        return await connectEvm(walletType);
      }
      if (walletType === 'tronlink') {
        return await connectTron();
      }
      if (walletType === 'trust-mobile') {
        const url = encodeURIComponent(location.href);
        window.location.href = `https://link.trustwallet.com/open_url?coin_id=60&url=${url}`;
        return;
      }
      if (walletType === 'ltc-watch') {
        // Disparado desde la UI mediante un modal aparte
        emit('ltc-prompt', {});
        return;
      }
      throw new Error('Wallet desconocida: ' + walletType);
    } catch (err) {
      emit('error', err);
      throw err;
    }
  }

  /* ---------- EVM (Trust / MetaMask) ---------- */
  async function connectEvm(walletType) {
    const raw = findEvmProvider(walletType);
    if (!raw) {
      if (walletType === 'trust') {
        window.open('https://trustwallet.com/download', '_blank');
        throw new Error('Trust Wallet no detectado. Instala la extensión o usa Trust Mobile.');
      }
      if (walletType === 'metamask') {
        window.open('https://metamask.io/download/', '_blank');
        throw new Error('MetaMask no detectado.');
      }
      throw new Error('No hay wallet EVM disponible.');
    }

    const accounts = await raw.request({ method: 'eth_requestAccounts' });
    if (!accounts?.length) throw new Error('Conexión cancelada.');

    const provider = new ethers.providers.Web3Provider(raw, 'any');
    const network = await provider.getNetwork();

    state = {
      type: 'evm', walletType,
      address: accounts[0],
      chainId: network.chainId,
      provider, rawProvider: raw,
      signer: provider.getSigner(),
      tronWeb: null,
    };
    bindEvmEvents(raw);
    persist();
    emit('connect', { ...state });
    return state;
  }

  function bindEvmEvents(raw) {
    if (!raw.on) return;
    raw.on('accountsChanged', (accs) => {
      if (!accs?.length) return disconnect();
      state.address = accs[0];
      emit('accountsChanged', { address: accs[0] });
    });
    raw.on('chainChanged', (hex) => {
      state.chainId = parseInt(hex, 16);
      emit('chainChanged', { chainId: state.chainId });
    });
    raw.on('disconnect', () => disconnect());
  }

  /* ---------- TRON (TronLink) ---------- */
  async function connectTron() {
    // Esperar a que TronLink inyecte
    let tries = 0;
    while (!window.tronLink && !window.tronWeb && tries < 10) {
      await new Promise((r) => setTimeout(r, 200));
      tries++;
    }
    if (!window.tronLink && !window.tronWeb) {
      window.open('https://www.tronlink.org/', '_blank');
      throw new Error('TronLink no detectado. Instala la extensión.');
    }

    if (window.tronLink?.request) {
      const res = await window.tronLink.request({ method: 'tron_requestAccounts' });
      if (res && res.code !== 200 && res.code !== undefined) {
        throw new Error(res.message || 'Conexión TronLink rechazada.');
      }
    }

    const tronWeb = window.tronWeb;
    if (!tronWeb || !tronWeb.defaultAddress?.base58) {
      throw new Error('Desbloquea TronLink y vuelve a intentarlo.');
    }

    state = {
      type: 'tron',
      walletType: 'tronlink',
      address: tronWeb.defaultAddress.base58,
      chainId: 'tron',
      provider: null, rawProvider: null, signer: null,
      tronWeb,
    };
    persist();
    emit('connect', { ...state });

    // Polling ligero por si el usuario cambia de cuenta
    if (!connectTron._poll) {
      connectTron._poll = setInterval(() => {
        const cur = window.tronWeb?.defaultAddress?.base58;
        if (state.type === 'tron' && cur && cur !== state.address) {
          state.address = cur;
          emit('accountsChanged', { address: cur });
        }
      }, 2000);
    }
    return state;
  }

  /* ---------- LTC watch-only ---------- */
  async function connectLtcWatch(address) {
    if (!address || !/^([LM3]|ltc1)[a-zA-Z0-9]{20,}$/.test(address)) {
      throw new Error('Dirección LTC inválida.');
    }
    state = {
      type: 'ltc', walletType: 'ltc-watch',
      address, chainId: 'ltc',
      provider: null, rawProvider: null, signer: null, tronWeb: null,
    };
    persist();
    emit('connect', { ...state });
    return state;
  }

  /* ---------- Balances ---------- */

  // Saldo nativo en una red EVM cualquiera vía RPC público
  async function fetchEvmNative(chainId, address) {
    const net = EVM_NETWORKS[chainId];
    if (!net) return null;
    const p = new ethers.providers.JsonRpcProvider(net.rpc);
    const wei = await p.getBalance(address);
    return { symbol: net.symbol, name: net.name, balance: ethers.utils.formatEther(wei) };
  }

  // Saldo de un token ERC20 en una red EVM
  async function fetchEvmToken(token, address) {
    const net = EVM_NETWORKS[token.chainId];
    if (!net) return null;
    try {
      const p = new ethers.providers.JsonRpcProvider(net.rpc);
      const c = new ethers.Contract(token.address, ERC20_ABI, p);
      const raw = await c.balanceOf(address);
      const balance = ethers.utils.formatUnits(raw, token.decimals);
      return { symbol: token.symbol, name: token.name, balance, network: net.name };
    } catch (e) {
      console.warn('Token fetch failed', token.symbol, e.message);
      return { symbol: token.symbol, name: token.name, balance: '0', network: net.name, error: true };
    }
  }

  // USDT TRC20 + TRX vía Trongrid
  async function fetchTronBalances(address) {
    const out = [];
    try {
      const r = await fetch(`https://api.trongrid.io/v1/accounts/${address}`);
      const j = await r.json();
      const sun = j.data?.[0]?.balance || 0;
      out.push({ symbol: 'TRX', name: 'TRON', balance: (sun / 1e6).toString(), network: 'TRON' });
    } catch (e) { console.warn('TRX fetch', e); }

    try {
      const r = await fetch(`https://api.trongrid.io/v1/accounts/${address}/tokens?contract_address=${TRON_USDT}`);
      const j = await r.json();
      const data = j.data?.[0];
      if (data) {
        const dec = data.decimals ?? 6;
        const bal = data.balance ?? '0';
        out.push({
          symbol: 'USDT', name: 'Tether (TRC20)',
          balance: (Number(bal) / Math.pow(10, dec)).toString(),
          network: 'TRON',
        });
      } else {
        out.push({ symbol: 'USDT', name: 'Tether (TRC20)', balance: '0', network: 'TRON' });
      }
    } catch (e) {
      console.warn('USDT-TRC20 fetch', e);
      out.push({ symbol: 'USDT', name: 'Tether (TRC20)', balance: '0', network: 'TRON', error: true });
    }
    return out;
  }

  // LTC vía BlockCypher
  async function fetchLtcBalance(address) {
    try {
      const r = await fetch(`https://api.blockcypher.com/v1/ltc/main/addrs/${address}/balance`);
      const j = await r.json();
      const bal = (j.final_balance || 0) / 1e8;
      return [{ symbol: 'LTC', name: 'Litecoin', balance: bal.toString(), network: 'Litecoin' }];
    } catch (e) {
      console.warn('LTC fetch', e);
      return [{ symbol: 'LTC', name: 'Litecoin', balance: '0', network: 'Litecoin', error: true }];
    }
  }

  /**
   * Devuelve un array de saldos según el tipo de wallet conectada.
   * Para EVM: consulta cross-chain ETH, BNB, MATIC + USDT (ERC20/BEP20), USDC, BUSD.
   */
  async function getAllBalances() {
    if (!state.address) return [];

    if (state.type === 'evm') {
      const tasks = [
        fetchEvmNative(1, state.address),
        fetchEvmNative(56, state.address),
        fetchEvmNative(137, state.address),
        ...EVM_TOKENS.map((t) => fetchEvmToken(t, state.address)),
      ];
      const results = await Promise.all(tasks.map((p) => p.catch(() => null)));
      return results.filter(Boolean);
    }

    if (state.type === 'tron') {
      return await fetchTronBalances(state.address);
    }

    if (state.type === 'ltc') {
      return await fetchLtcBalance(state.address);
    }
    return [];
  }

  /* ---------- Misc ---------- */
  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      walletType: state.walletType, type: state.type, address: state.address,
    }));
  }

  function disconnect() {
    if (connectTron._poll) { clearInterval(connectTron._poll); connectTron._poll = null; }
    state = { type: null, walletType: null, address: null, chainId: null, provider: null, rawProvider: null, signer: null, tronWeb: null };
    localStorage.removeItem(STORAGE_KEY);
    emit('disconnect', {});
  }

  async function autoConnect() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    try {
      const { walletType, type, address } = JSON.parse(saved);
      if (type === 'ltc' && address) return await connectLtcWatch(address);
      if (type === 'tron') {
        if (window.tronWeb?.defaultAddress?.base58) return await connectTron();
        return null;
      }
      if (type === 'evm') {
        const raw = findEvmProvider(walletType);
        if (!raw) return null;
        const accs = await raw.request({ method: 'eth_accounts' });
        if (!accs?.length) return null;
        const provider = new ethers.providers.Web3Provider(raw, 'any');
        const network = await provider.getNetwork();
        state = {
          type: 'evm', walletType,
          address: accs[0], chainId: network.chainId,
          provider, rawProvider: raw, signer: provider.getSigner(),
          tronWeb: null,
        };
        bindEvmEvents(raw);
        emit('connect', { ...state });
        return state;
      }
    } catch (e) { console.warn('autoConnect', e); }
    return null;
  }

  function shortAddress(a) { return a ? a.slice(0, 6) + '…' + a.slice(-4) : ''; }
  function getState() { return { ...state }; }

  function getChainLabel() {
    if (state.type === 'evm') return EVM_NETWORKS[state.chainId]?.name || `Chain ${state.chainId}`;
    if (state.type === 'tron') return 'TRON';
    if (state.type === 'ltc')  return 'Litecoin';
    return '';
  }

  global.NumesWallet = {
    connect, disconnect, autoConnect,
    connectLtcWatch,
    getAllBalances,
    getState, getChainLabel, shortAddress,
    on,
    EVM_NETWORKS, EVM_TOKENS,
  };
})(window);
