
// TODO - expiration date for push notifications

/**
 * @author
 * @copyright
 */
var g = require('./global.js');

var self;

module.exports = {

  WS_PUSH: 'push',
  
  _cacheKey: function (clientId) {
    return 'push_' + clientId;
  },
  
  _deliver: function (clientId, msg) {
    // Fundamentally asynchronous so always check if WebSocket connection is
    // still open since client may have disconnected while fetching data from
    // cache server (redis).
    var res = false;
    var socs = g.getSockets(clientId);
    for (var i = 0; i < socs.length; i++) {
      var soc = socs[i];
      if (soc.connected) {
        soc.emit(this.WS_PUSH, msg);
        res = true;
      }
    }
    // Socket closed. If there are any pending push notifications, those will be
    // delivered on reconnection.
    return res;
  },

  flush: function (clientId) {
    // peek to see if there is a pending notification
    // redis.LRANGE() returns an array
    g['redis'].LRANGE(self._cacheKey(clientId), 0, 0, function (err, ret) {
      if (err != null) {
        console.log('redis: ' + err);
      } else if (!g.empty(ret) && self._deliver(clientId, ret[0])) {
        g['redis'].LPOP(self._cacheKey(clientId), function (err, ret) {
          if (err != null) {
            console.log('redis: ' + err);
          } else {
            self.flush(clientId); 
          } 
        });
      }
    });
  },

  queue: function (clientId, msg) {
    // deliver immediately if the user is online
    var socs = g.getSockets(clientId);
    if (socs.length > 0) {
      for (var i = 0; i < socs.length; i++) {
        var soc = socs[i];
        if (soc.connected) {
          soc.emit(this.WS_PUSH, msg);
        } else {
          console.log('Error - ' + soc.name + ' not connected');
        }
      }
      return;
    }
    g['redis'].RPUSH(self._cacheKey(clientId), msg, function (err, ret) {
      if (err != null) {
        console.log('Error - ' + err);
      } else {
        //self.flush(clientId);
      }
    });
  },
}

self = module.exports
