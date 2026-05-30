const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { ModuleFederationPlugin } = require('webpack').container;
const deps = require('./package.json').dependencies;

// Emit real .map siblings by default so the remote doubles as a positive
// demo case for the DOM Lens sourcemap probe. Set SOURCEMAPS=0 to test
// the "no sourcemap" path (probe → missing → Map module fallback).
const sourcemapsOn = process.env.SOURCEMAPS !== '0';

module.exports = {
  entry: './src/index.js',
  devtool: sourcemapsOn ? 'source-map' : false,
  output: {
    path: path.resolve(__dirname, 'dist'),
    publicPath: 'auto',
  },
  devServer: {
    port: 3002,
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
      name: 'remote_app',
      filename: 'remoteEntry.js',
      exposes: {
        './Widget': './src/Widget',
        './Counter': './src/Counter',
      },
      shared: {
        react: { singleton: true, requiredVersion: deps.react },
        'react-dom': { singleton: true, requiredVersion: deps['react-dom'] },
      },
    }),
    new HtmlWebpackPlugin({ template: './public/index.html' }),
  ],
};
