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
        if (g.isconnected(clientId)) {
            console.log('Push - {0}, {1}'.format(clientId, msg));
            g.io.sockets.in(String(clientId)).emit(self.WS_PUSH, msg);
            return true;
        }
        return false;
        /*
        var res = false;
        var socs = g.getSockets(clientId);
        for (var i = 0; i < socs.length; i++) {
            var soc = socs[i];
            if (soc.connected && soc.ready) {
                soc.emit(self.WS_PUSH, msg);
                res = true;
            } else {
                g.error('Error - ' + soc.name + ' not connected or ready');
            }
        }
        return res;
        */
    },

    flush: function (clientId) {
        // peek to see if there is a pending notification
        // redis.LRANGE() returns an array
        g['redis'].LRANGE(self._cacheKey(clientId), 0, 0, function (err, ret) {
            if (err != null) {
                g.error(err);
            } else if (!g.empty(ret) && self._deliver(clientId, ret[0])) {
                g['redis'].LPOP(self._cacheKey(clientId), function (err, ret) {
                    if (err != null) {
                        g.error(err);
                    } else {
                        self.flush(clientId); 
                    } 
                });
            }
        });
    },

    queue: function (clientId, msg) {
        // deliver immediately if the user is online, otherwise queue in redis
        if (self._deliver(clientId, msg)) {
            self.flush(clientId);
        } else {
            g['redis'].RPUSH(self._cacheKey(clientId), msg, function (err, ret) {
                if (err != null) {
                    g.error('Error - ' + err);
                } else {
                    //self.flush(clientId);
                }
            });
        }
    },
}

self = module.exports
