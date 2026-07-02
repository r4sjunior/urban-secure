import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,

  async headers() {
    // Origens permitidas para imagens (map tiles + IPFS)
    const imgSrc = [
      "'self'",
      'data:',
      'blob:',
      'https://gateway.pinata.cloud',
      'https://*.basemaps.cartocdn.com',
      'https://*.ipfs.nftstorage.link',
    ].join(' ');

    // Origens de conexão: RPC proxy local + fallbacks públicos Solana + Pinata metadata
    const connectSrc = [
      "'self'",
      'https://*.helius-rpc.com',
      'https://api.pinata.cloud',
      'https://gateway.pinata.cloud',
      'https://api.mainnet-beta.solana.com',
      'https://api.devnet.solana.com',
    ].join(' ');

    const csp = [
      "default-src 'self'",
      // Next.js e styled-jsx precisam de unsafe-inline/unsafe-eval
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      `img-src ${imgSrc}`,
      `connect-src ${connectSrc}`,
      "frame-src https://audius.co",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; ');

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy',       value: csp },
          { key: 'X-Content-Type-Options',         value: 'nosniff' },
          // DENY impede que o app seja embutido em iframes de terceiros
          { key: 'X-Frame-Options',                value: 'DENY' },
          { key: 'X-XSS-Protection',               value: '1; mode=block' },
          { key: 'Referrer-Policy',                 value: 'strict-origin-when-cross-origin' },
          // Geolocalização e câmera apenas para a própria origem
          { key: 'Permissions-Policy',              value: 'geolocation=(self), camera=(self), microphone=(), payment=(), usb=()' },
          { key: 'Strict-Transport-Security',       value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
    ];
  },

  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false, os: false, path: false, net: false, tls: false, child_process: false,
        crypto:  require.resolve('crypto-browserify'),
        stream:  require.resolve('stream-browserify'),
        buffer:  require.resolve('buffer'),
        process: require.resolve('process/browser'),
        assert:  require.resolve('assert'),
        url:     require.resolve('url'),
      };
      config.plugins.push(
        new webpack.ProvidePlugin({
          process: 'process/browser',
          Buffer:  ['buffer', 'Buffer'],
        })
      );
    }
    return config;
  },
};

export default nextConfig;
