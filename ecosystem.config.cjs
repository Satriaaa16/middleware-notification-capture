module.exports = {
  apps: [
    {
      name: 'temporal-server',
      script: 'temporal',
      args: 'server start-dev --db-filename ./temporal-state.db --ip 127.0.0.1',
    },
    {
      name: 'sre-worker',
      script: './worker.js',
      max_memory_restart: '1G',
    },
    {
      name: 'sre-webhook-receiver',
      script: './middle-server.js',
    }
  ]
};
