/**
 * @author
 * @copyright
 */
var g = require('./global.js');
var that;
module.exports = {
  WS_PUSH: 'push',
  _cacheKey: function (uid) {
    return 'push_' + uid;
  },
  _deliver: function (uid, msg) {
    // Fundamentally asynchronous so always check if WebSocket connection is
    // still open since client may have disconnected while fetching data from
    // cache server (redis).
    var soc = g.getSocket(uid);
    if (!g.isEmpty(soc) && soc.connected) {
      soc.emit(this.WS_PUSH, msg);
      return true;
    }
    // Socket closed. If there are any pending push notifications, those will be
    // delivered on reconnection.
    return false;
  },

  flush: function (uid) {
    // Peek to see if there is a pending notification.
    // XXX: redis.LRANGE() returns an array!
    g['redis'].LRANGE(that._cacheKey(uid), 0, 0, function (err, ret) {
      if (err != null) {
        console.log('redis: ' + err);
      } else if (!g.isEmpty(ret) && that._deliver(uid, ret[0])) {
        g['redis'].LPOP(that._cacheKey(uid), function (err, ret) {
          if (err != null) {
            console.log('redis: ' + err);
          } else {
            that.flush(uid); 
          } 
        });
      }
    });
  },

  queue: function (uid, msg) {
    g['redis'].RPUSH(that._cacheKey(uid), msg, function (err, ret) {
      if (err != null) {
        console.log('redis: ' + err)
      } else {
        that.flush(uid);
      }
    });
  },
}
that = module.exports
