# Numes — DeFi Landing + Wallet Connect

Landing page Web3 con integración de conexión a wallets (MetaMask, Coinbase Wallet, wallets inyectadas EIP-1193 y WalletConnect via deep-link).

## Estructura

```
WEB3/
├── index.html
├── css/
│   └── styles.css
├── js/
│   ├── wallet.js   ← módulo reutilizable (API NumesWallet)
│   └── app.js      ← lógica UI (modal, botones, toasts)
└── img/
```

## Cómo ejecutar

Como usa módulos vía CDN, basta con abrir `index.html` con un servidor estático.

### Opción 1 — Live Server (VS Code)
Click derecho en `index.html` → **Open with Live Server**.

### Opción 2 — Python
```powershell
python -m http.server 5500
```
Luego abre http://localhost:5500

### Opción 3 — Node
```powershell
npx serve .
```

## Probar el Wallet Connect

1. Instala [MetaMask](https://metamask.io/) en tu navegador.
2. Abre la página y pulsa **Connect Wallet**.
3. Selecciona **MetaMask** en el modal.
4. Acepta la conexión en el popup de MetaMask.
5. El botón mostrará tu dirección abreviada (ej. `0x1234…abcd`) y un toast con tu red y saldo.

Pulsa el botón nuevamente para **desconectar**.

## API expuesta — `window.NumesWallet`

```js
NumesWallet.connect('metamask' | 'coinbase' | 'injected' | 'walletconnect');
NumesWallet.disconnect();
NumesWallet.autoConnect();           // restaura sesión previa
NumesWallet.getBalance();            // saldo nativo formateado
NumesWallet.switchChain(chainId);    // cambia de red
NumesWallet.getState();              // { address, chainId, signer, provider, ... }
NumesWallet.on((event, data) => {}); // 'connect' | 'disconnect' | 'accountsChanged' | 'chainChanged' | 'error'
```

## Redes soportadas (extensible en `js/wallet.js`)

Ethereum (1), BNB Chain (56), Polygon (137), Avalanche (43114), Arbitrum (42161), Optimism (10).

## WalletConnect completo (opcional)

La integración actual abre el deep-link móvil. Para soporte completo con QR de escritorio:

1. Crea un projectId gratis en https://cloud.walletconnect.com.
2. Instala el SDK: `npm i @walletconnect/ethereum-provider`.
3. Sustituye la rama `walletconnect` en `js/wallet.js` por la inicialización del SDK con tu `projectId`.

## Dependencias (vía CDN, sin build)

- `ethers@5.7.2` — interacción con la blockchain
- `lucide` — iconos
- Google Fonts (Inter)
