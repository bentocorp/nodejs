/**
 * @author
 * @copyright
 */
var winston = require('winston');
var format = function (options) {
    //console.log(options);
    var level= "",
        padding = 5 - options.level,
        msg  = "";
    for (; padding > 0; padding--) {
        level += ' ';
    }
    if (options.meta.stack) {
        msg = options.meta.stack.join("\n");
    } else {
        msg = options.message;
    }
    level += options.level.toUpperCase();
    return (new Date).toISOString() + ' ' + level + ' ' + process.pid + ' - ' + msg;
}
var logger = new winston.Logger({
    transports: [
        new winston.transports.Console({
            name: 'console',
            level: 'debug',
            formatter: function (options) { if (options.meta.stack) return options.meta.stack.join('\n'); else return options.message; },
            json: false,
            handleExceptions: true,
        }),
        new winston.transports.File({
            name: 'debug-log',
            filename: 'debug.log',
            level: 'debug',
            formatter: format,
            json: false,
        }),
        new winston.transports.File({
            name: 'error-log',
            filename: 'error.log',
            level: 'error',
            formatter: format,
            json: false,
            handleExceptions: true,
            colorize: true,
        }),
    ]
});

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

// Use "self" instead of "this" because context is variable based on how functions
// are invoked
var self;

module.exports = {

    debug: function (msg) {
        logger.debug(msg);
    },

    error: function (err) {
        var msg = self.getOrElse(err.stack, err);
        logger.error(msg);
    },

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

    groups: {

    },

    /* Helper functions */

    str: function (obj) {
        return JSON.stringify(obj);
    },

    isset: function (obj) {
        return obj != undefined;
    },

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
        var obj = self;
        for (var i = 0; i < parts.length; i++) {
            var name = parts[i];
            if (!isset(obj[name])) {
                obj[name] = new Object();
            }
            obj = obj[name];
        }
        return obj;
    },
  
    setSocketId: function (clientId, sid) {
        if (!self.isset(self.sockets[clientId])) {
            self.sockets[clientId] = [];
        }
        self.sockets[clientId].push(sid);
    },

    getSockets: function (clientId) {
        var sids = self.sockets[clientId]; // c-3007: [1234, 9876, 8060]
        var socs = [];
        if (self.isset(sids)) {
            for (var i = 0; i < sids.length; i++) {
                var sid = sids[i],
                    soc = self.io.sockets.connected[sid];
                if (!self.isset(soc)) {
                    self.error('Error - sid {0} does not exist for {1}'.format(sid, clientId));
                } else {
                    socs.push(soc);
                }
            }
        }
        return socs;
    },

    getOrElse: function (obj, dyfault) {
        if (self.isset(obj)) {
            return obj;
        } else {
            return dyfault;
        }
    },

    idgen: new (function () {
        var ids = {
            // 'some-key': { cnt: 8, available: [0, 4, 5] }
        };
        this.next = function (key) {
            key = String(key);
            if (!self.isset(ids[key])) {
                ids[key] = {
                    cnt: -1, available: [],
                };
            }
            var cnt;
            if (ids[key].available.length <= 0) {
                cnt = ++(ids[key].cnt);
            } else {
                cnt = ids[key].available.shift();
            }
            return '{0}-{1}'.format(key, cnt);
        };
        // Free an id so that it can be reused
        this.free = function (id) {
            var parts = String(id).split('-'); // some-key-0
            if (parts.length < 2) {
                self.error('Error - malformed id ' + id);
                return;
            }
            var cnt = parseInt(parts[parts.length - 1]);
            parts.pop();
            var key = parts.join('-');
            if (!self.isset(ids[key])) {
                self.error('Error - Trying to free {0} but key not found'.format(id));
            } else if (ids[key].available.indexOf(cnt) >= 0) {
                self.error('Error - id {0} has already been released'.format(id));
            } else {
                //self.debug('releasing key={0}, cnt={1} for reconsumption'.format(key, cnt));
                // XXX - insert key into the correct sorted position!
                ids[key].available.push(cnt);
            }
        };
    })(),
};

self = module.exports;
