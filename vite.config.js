const { defineConfig } = require('vite');
const react = require('@vitejs/plugin-react');
const reactPlugin = react.default || react;

module.exports = defineConfig({
  plugins: [reactPlugin()],
  base: '/ResumeTailor/',
});
