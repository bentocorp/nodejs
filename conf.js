/**
 * @author
 * @copyright
 */
module.exports = {
  local: {
    server: {
      port: 8080,
    },
    redis: {
      host: '127.0.0.1',
      port: 6379,
    }
  },
  
  dev: {
    server: {
      port: 8081, // 8080 is being used by another process?
    },
    redis: {
      host: '127.0.0.1',
      port: 6379,
    }    
  },
}
