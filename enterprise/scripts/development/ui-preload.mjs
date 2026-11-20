if(process.env.NODE_ENV!=='development'||!process.env.QICORE_DEV_WORKSPACE)throw Error('DEVELOPMENT_PRELOAD_FORBIDDEN');
process.on('message',message=>{if(message==='qicore-development-stop'){process.emit('SIGINT');if(process.connected)process.disconnect()}});
