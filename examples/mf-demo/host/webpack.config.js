const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { ModuleFederationPlugin } = require('webpack').container;
const deps = require('./package.json').dependencies;

// Sourcemap-emission knobs for DOM Lens demos:
//   default     → devtool: 'source-map'        (.map + embedded sourcesContent)
//   NOSOURCES=1 → devtool: 'nosources-source-map' (.map without sourcesContent
//                                                  — the production case where
//                                                  the GitHub-source-fetch path
//                                                  is the only way to see source)
//   SOURCEMAPS=0 → devtool: false              (no .map at all — probe shows
//                                                "missing", Map module fallback)
const sourcemapsOn = process.env.SOURCEMAPS !== '0';
const noSources = process.env.NOSOURCES === '1';
const devtool = !sourcemapsOn ? false : noSources ? 'nosources-source-map' : 'source-map';

module.exports = {
  entry: './src/index.js',
  devtool,
  output: {
    path: path.resolve(__dirname, 'dist'),
    publicPath: 'auto',
  },
  devServer: {
    port: 3001,
    static: { directory: path.resolve(__dirname, 'public') },
    historyApiFallback: true,
    headers: { 'Access-Control-Allow-Origin': '*' },
  },
  resolve: { extensions: ['.js', '.jsx'] },
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              '@babel/preset-env',
              ['@babel/preset-react', { runtime: 'automatic' }],
            ],
          },
        },
      },
    ],
  },
  plugins: [
    new ModuleFederationPlugin({
      name: 'host_app',
      remotes: {
        remote_app: 'remote_app@http://localhost:3002/remoteEntry.js',
      },
      shared: {
        react: { singleton: true, requiredVersion: deps.react },
        'react-dom': { singleton: true, requiredVersion: deps['react-dom'] },
      },
    }),
    new HtmlWebpackPlugin({ template: './public/index.html' }),
  ],
};
