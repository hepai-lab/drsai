module.exports = {
  apps: [{
    name: 'run_docmaster',
    script: './run_docmaster.sh',
    interpreter: 'bash',
    cwd: __dirname,
    env: {
      // Remote OIDC requests must use a request-scoped delegated credential;
      // never fall back to a static/frontend model key.
      OPENDRSAI_OIDC_ONLY: '1',
      // This host has two interfaces. The 10.42 address is container-internal;
      // ai-dev must use the externally reachable net1 address.
      WORKER_IP: '10.5.8.136',
    },
    instances: 1,
    autorestart: true,

    // The agent writes runtime state below this tree. Watching the project causes
    // PM2 to restart the worker mid-request and briefly invalidates registration.
    watch: false,

    max_memory_restart: '1G',
    kill_timeout: 5000,
    restart_delay: 1000,
  }],
};
