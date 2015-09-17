/**
 * @author
 * @copyright
 */
// Use "that" instead of "this" because context is variable based on how functions
// are invoked.
var that;
module.exports = {
    
    /* Global properties */

    server: null, // http.Server

    io    : null, // socket.io.Server

    redis : null, // node_redis

    mysql : null,

    // Map of user identifiers (uid) to an array of associated WebSocket identifiers (sid)
    // e.g. sockets['c-500'] = ['1a92be7', '2ez7y05'];
    sockets: {
        // a - admin, d - driver, c - customer
    },

    // Access tokens; automatically generated after successful authentication
    // See /api/authenticate
    tokens: {

    },

    /* Helper functions */

    /**
     * This is not a "toString" method!
     * @return
     */
    str: function (obj) {
        return JSON.stringify(obj);
    },

    /**
     * @return
     */
    isset: function (obj) {
        return typeof obj !== 'undefined';
    },

    /**
    * @return
    */
    empty: function (obj) {
        switch (typeof obj) {
            case 'undefined': return true;
            case 'number'   : return obj == 0;
            case 'boolean'  : return obj == false;
            case 'string'   : return obj == '';
            case 'object':
                // 
                if (obj == null || obj.length === 0) {
                    return true;
                }
                //
                if (obj.length > 0) {
                    return false;
                }
                // Speed up calls to hasOwnProperty
                var hasOwnProperty = Object.prototype.hasOwnProperty;
                for (key in obj) {
                    if (hasOwnProperty.call(obj, key)) {
                        return false;
                    }
                }
                return true;
            default:
                throw new Error('Unsupported type: ' + typeof obj);
        }
    },

    /**
     * Use to dynamically create a global object.
     * @return The existing or newly created global object (singleton).
     */
    ns: function (str) {
        var parts = str.split('.');
        var obj = that;
        for (var i = 0; i < parts.length; i++) {
            var name = parts[i];
            if (!isset(obj[name])) {
                obj[name] = new Object();
            }
            obj = obj[name];
        }
        return obj;
    },
  
    setSocket: function (clientId, sid) {
        if (!self.isset(self.sockets[clientId])) {
            self.sockets[clientId] = [];
        }
        self.sockets[clientId].push(sid);
    },

    /**
     * @return
     */
    getSockets: function (clientId) {
        clientId = String(clientId);
        var sids = self.sockets[clientId]; // c-3007: [1234, 9876, 8060]
        if (self.isset(sids) && sids.length > 0) {
            var socs = [];
            for (var i = 0; i < sids.length; i++) {
                socs.push(self.io.sockets.connected[sids[i]]);
            }
            return socs;
        } else {
            return [];
        }
    },

    get: function (array, key, dyfault) {
        if (self.isset(array[key])) {
            return array[key];
        } else {
            return dyfault;
        }
    },

    /* id gen */
    idgen: new (function () {
        var _ids = {
            // 'socket': { cnt: 8, available: [0, 4, 5] }
        };
        this.next = function (key) {
            key = String(key);
            if (!self.isset(_ids[key])) {
                _ids[key] = {
                    cnt: -1, available: [],
                };
            }
            if (_ids[key].available.length == 0) {
                return ++_ids[key].cnt;
            } else {
                return _ids[key].available.shift();
            }
        };
        this.free = function (id) {
            var parts = String(id).split('-'); // socket-0
            if (parts.length != 2) {
                console.log('Error - malformed id ' + id);
            } else if (!self.isset(_ids[parts[0]])) {
                console.log('Error - Trying to free ' + id + ' but key not found');
            } else if (_ids[parts[0]].available.indexOf(parts[1]) >= 0) {
                console.log('Error - id ' + id + ' has already been released');
            } else {
                _ids[parts[0]].available.push(parts[1]);
            }
        };
    })(),
};

var self = module.exports;

that = module.exports;

// printf-ish function (from Stack Overflow)
// http://stackoverflow.com/questions/610406/javascript-equivalent-to-printf-string-format/4673436#4673436
if (!String.prototype.format) {
    String.prototype.format = function() {
        var args = arguments;
        return this.replace(/{(\d+)}/g, function (match, number) {
            return typeof args[number] != 'undefined' ? args[number] : match;
        });
    };
}
