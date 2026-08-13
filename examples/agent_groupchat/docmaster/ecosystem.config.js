module.exports = {
  apps: [{
    name: 'run_docmaster',
    script: './run_docmaster.sh',
    interpreter: 'bash',
    cwd: __dirname,
    instances: 1,
    autorestart: true,

    // Development mode: restart when source/configuration files change.
    watch: ['.'],
    watch_delay: 1000,
    ignore_watch: [
      '.git',
      '.agents',
      '.codex',
      '**/__pycache__',
      '**/*.pyc',
      'workspace',
      'logs',
      'test_ppt',
      'node_modules',
    ],

    max_memory_restart: '1G',
    kill_timeout: 5000,
    restart_delay: 1000,
  }],
};
