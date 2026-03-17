module.exports = {
    apps: [
        {
            name: 'node-whatsbot',
            script: 'index.js',
            cwd: '/home/hugo.andrade/node_whatsbot',
            exec_mode: 'fork',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '300M',
            env: {
                NODE_ENV: 'production'
            }
        }
    ]
};