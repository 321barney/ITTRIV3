module.exports = {
  extends: ['next', 'next/core-web-vitals', 'plugin:jsx-a11y/recommended'],
  plugins: ['jsx-a11y'],
  rules: {
    'jsx-a11y/anchor-has-content': ['error', { components: ['Link'] }],
    'jsx-a11y/aria-proptypes': 'error',
    'jsx-a11y/no-static-element-interactions': 'off',
    'jsx-a11y/click-events-have-key-events': 'off',
  },
};
