/* =========================================================
   app.js — UI: modal wallet, balances panel
   ========================================================= */
(function () {
  'use strict';

  if (window.lucide) lucide.createIcons();

  const $  = (s, p = document) => p.querySelector(s);
  const $$ = (s, p = document) => Array.from(p.querySelectorAll(s));

  const modal         = $('#walletModal');
  const toast         = $('#toast');
  const btnNav      = $('#connectBtnNav');
  const btnHero     = $('#connectBtnHero');
  const balPanel    = $('#balancesPanel');
  const balGrid     = $('#balancesGrid');
  const chainTag    = $('#chainTag');
  const addrTag     = $('#addrTag');
  const copyAddrBtn = $('#copyAddr');
  const refreshBtn  = $('#refreshBal');
  const disconnectBtn = $('#disconnectBtn');

  /* ---------- Helpers ---------- */
  const openModal  = (m) => { m.classList.add('open'); m.setAttribute('aria-hidden', 'false'); };
  const closeModal = (m) => { m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); };

  modal.addEventListener('click', (e) => { if (e.target.matches('[data-close]')) closeModal(modal); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal(modal);
  });

  let toastTimer;
  function showToast(msg, type = '') {
    clearTimeout(toastTimer);
    toast.textContent = msg;
    toast.className = 'toast show ' + type;
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
  }

  /* ---------- Botón principal ---------- */
  function handleMain() {
    const s = NumesWallet.getState();
    if (s.address) NumesWallet.disconnect();
    else openModal(modal);
  }
  btnNav.addEventListener('click', handleMain);
  btnHero.addEventListener('click', handleMain);
  disconnectBtn.addEventListener('click', () => NumesWallet.disconnect());

  /* ---------- Selección de wallet ---------- */
  $$('.wallet-option').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const type = btn.dataset.wallet;
      try {
        showToast('Conectando…');
        await NumesWallet.connect(type);
        closeModal(modal);
      } catch (err) {
        showToast(err.message || 'No se pudo conectar', 'error');
      }
    });
  });

  /* ---------- Botón conectado ---------- */
  function setConnected(btn, addr) {
    btn.classList.add('connected');
    const lbl = btn.querySelector('.btn-label');
    if (lbl) lbl.textContent = NumesWallet.shortAddress(addr);
  }
  function setDisconnected(btn) {
    btn.classList.remove('connected');
    const lbl = btn.querySelector('.btn-label');
    if (lbl) lbl.textContent = 'Connect Wallet';
  }

  /* ---------- Render del panel de balances ---------- */
  const TOKEN_ICONS = {
    ETH:  { bg: 'linear-gradient(135deg,#7c8aff,#5b6cff)', glyph: 'Ξ' },
    BNB:  { bg: 'linear-gradient(135deg,#ffc24a,#f0a020)', glyph: '◆' },
    MATIC:{ bg: 'linear-gradient(135deg,#a06bff,#7c4dff)', glyph: '⬡' },
    USDT: { bg: 'linear-gradient(135deg,#26a17b,#1f8a67)', glyph: '₮' },
    USDC: { bg: 'linear-gradient(135deg,#2775ca,#1c5ea3)', glyph: '$' },
    BUSD: { bg: 'linear-gradient(135deg,#f0b90b,#c69408)', glyph: '$' },
    LTC:  { bg: 'linear-gradient(135deg,#a6a9b6,#6b7280)', glyph: 'Ł' },
    TRX:  { bg: 'linear-gradient(135deg,#ff5b5b,#e8443a)', glyph: '◊' },
  };

  function fmt(n) {
    const num = Number(n);
    if (!isFinite(num) || num === 0) return '0';
    if (num < 0.0001) return num.toExponential(2);
    if (num < 1) return num.toFixed(6);
    if (num < 1000) return num.toFixed(4);
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function renderBalances(list) {
    if (!list?.length) {
      balGrid.innerHTML = '<p class="muted">Sin saldos para mostrar.</p>';
      return;
    }
    balGrid.innerHTML = list.map((t) => {
      const ic = TOKEN_ICONS[t.symbol] || { bg: '#888', glyph: '●' };
      const errBadge = t.error ? '<span class="err-badge">err</span>' : '';
      const net = t.network ? `<span class="net">${t.network}</span>` : '';
      return `
        <div class="bal-card">
          <div class="bal-icon" style="background:${ic.bg}">${ic.glyph}</div>
          <div class="bal-info">
            <strong>${t.symbol} ${errBadge}</strong>
            <span>${t.name || ''} ${net}</span>
          </div>
          <div class="bal-amount">${fmt(t.balance)}</div>
        </div>`;
    }).join('');
  }

  async function loadBalances() {
    balGrid.innerHTML = `
      <div class="bal-loading">
        <div class="spinner"></div>
        <span>Cargando saldos…</span>
      </div>`;
    try {
      const list = await NumesWallet.getAllBalances();
      renderBalances(list);
    } catch (e) {
      balGrid.innerHTML = `<p class="err">Error: ${e.message}</p>`;
    }
  }

  refreshBtn.addEventListener('click', () => loadBalances());
  copyAddrBtn.addEventListener('click', async () => {
    const a = NumesWallet.getState().address;
    if (!a) return;
    await navigator.clipboard.writeText(a);
    showToast('Dirección copiada', 'success');
  });

  /* ---------- Eventos del módulo ---------- */
  NumesWallet.on(async (event, data) => {
    switch (event) {
      case 'connect': {
        setConnected(btnNav, data.address);
        setConnected(btnHero, data.address);
        chainTag.textContent = NumesWallet.getChainLabel();
        addrTag.textContent  = NumesWallet.shortAddress(data.address);
        balPanel.hidden = false;
        showToast('Conectado · ' + NumesWallet.getChainLabel(), 'success');
        await loadBalances();
        break;
      }
      case 'accountsChanged':
        setConnected(btnNav, data.address);
        setConnected(btnHero, data.address);
        addrTag.textContent = NumesWallet.shortAddress(data.address);
        showToast('Cuenta cambiada');
        loadBalances();
        break;
      case 'chainChanged':
        chainTag.textContent = NumesWallet.getChainLabel();
        showToast('Red: ' + NumesWallet.getChainLabel());
        loadBalances();
        break;
      case 'disconnect':
        setDisconnected(btnNav);
        setDisconnected(btnHero);
        balPanel.hidden = true;
        balGrid.innerHTML = '';
        showToast('Wallet desconectada');
        break;
      case 'error':
        console.error(data);
        break;
    }
    if (window.lucide) lucide.createIcons();
  });

  /* ---------- Auto-reconectar ---------- */
  window.addEventListener('load', () => NumesWallet.autoConnect());
})();
