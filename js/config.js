const CONFIG = {
  DEMO_MODE: true,
  API_BASE: window.location.hostname === 'localhost'
    ? 'http://localhost:8888/.netlify/functions'
    : '/.netlify/functions',
  ANTHROPIC_API_KEY: '',
  REPLICATE_API_KEY: '',
};
