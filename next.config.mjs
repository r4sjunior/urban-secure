import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Desativado: o StrictMode desmonta/remonta componentes duas vezes no dev,
  // o que quebra o Leaflet (mapa é destruído antes do callback do GPS disparar).
  reactStrictMode: false,

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
