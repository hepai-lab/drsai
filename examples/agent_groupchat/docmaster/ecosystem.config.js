module.exports = {
  apps: [{
    name: 'docmaster',
    script: '/aifs/user/home/haiuser01/drsai_code/examples/agent_groupchat/docmaster/run_docmaster.py',
    interpreter: 'python3',
    cwd: '/aifs/user/home/haiuser01/drsai_code/examples/agent_groupchat/docmaster',
    env: {
      PYTHONPATH: '/aifs/user/home/haiuser01/drsai_code'
    },
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    error_file: '/aifs/user/home/haiuser01/drsai_code/examples/agent_groupchat/docmaster/logs/err.log',
    out_file: '/aifs/user/home/haiuser01/drsai_code/examples/agent_groupchat/docmaster/logs/out.log',
    log_file: '/aifs/user/home/haiuser01/drsai_code/examples/agent_groupchat/docmaster/logs/combined.log',
    time: true,
    kill_timeout: 5000,
    restart_delay: 4000,
  }]
};
