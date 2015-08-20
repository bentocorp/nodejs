/**
 * @author
 * @copyright
 */
var g = require('./global.js');
module.exports = {
  WS_PUSH: 'push',
  _cacheKey: function (uid) {
    return 'push_' + uid;
  },
  deliver: function (uid, msg) {
    // Fundamentally asynchronous so always check if WebSocket connection is
    // still open since client may have disconnected while fetching data from
    // cache server (redis).
    var soc = g.getSocket(uid);
    if (g.isset(soc) && soc.connected) {
      soc.emit(this.WS_PUSH, msg);
      return true;
    }
    // Socket closed. If there are any pending push notifications, those will be
    // delivered on reconnection.
    return false;
  },

  flush: function (uid) {
    var that = this;
    // Peek to see if there is a pending notification.
    g['redis'].lrange(this._cacheKey(uid), 0, 0, function (err, ret) {
      if (!g.isEmpty(ret) && that.deliver(uid, ret)) {
        g['redis'].lpop(that._cacheKey(uid), function (err, ret) {
          that.flush(uid);          
        });
      }
    });
  },

  queue: function (uid, msg) {
    var that = this;
    g['redis'].rpush(this._cacheKey(uid), msg, function (err, ret) {
      that.flush(uid);
    });
  },
}

