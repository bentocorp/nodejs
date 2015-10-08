/**
 * @author
 * @copyright
 */
var winston = require('winston');

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

function prepend(val, width, str) {
    // Default to prepending zeros for dates
    width = (width == undefined) ? 2 : width;
    str = (str == undefined) ? "0" : str;
    var res = "", 
        padding = width - String(val).length;
    for (; padding > 0; padding--) {
        res += str;
    }
    return res + val;
}

var format = function (options) {
    //console.log(options);
    var level = prepend(options.level.toUpperCase(), 5, ' '),
        msg = "";
    if (options.meta.stack) {
        msg = options.meta.stack.join("\n");
    } else {
        msg = options.message;
    }
    // Make sure the host is configured with the right timezone! (-0700 or pacific time for SF)
    // sudo rm /etc/localtime && sudo ln -s /usr/share/zoneinfo/US/Pacific /etc/localtime
    var date  = new Date();
    var dateStr = "{0}-{1}-{2} {3}:{4}:{5}".format(date.getFullYear(), prepend(date.getMonth() + 1), prepend(date.getDate()),
        prepend(date.getHours()), prepend(date.getMinutes()), prepend(date.getSeconds()));
    //console.log(dateStr);
    return dateStr + ' ' + level + ' ' + process.pid + ' - ' + msg;
}

var logger = new winston.Logger({
    transports: [
        new winston.transports.Console({
            name: 'console',
            level: 'debug',
            formatter: function (options) { if (options.meta.stack) return options.meta.stack.join('\n'); else return options.message; },
            json: false,
            handleExceptions: true,
            debugStdout: true, // Write to stdout not stderr! Default is false (unintuitively); caused a lot of problems with Capistrano!
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

    nio   : null,

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

    ackServerHeartbeat: function (serverId) {
        var socs = self.sockets[serverId];
        if (!self.isset(socs)) {
            self.sockets[serverId] = {
                connected: { }
            };
        }
        self.sockets[serverId].heartbeatTs = (new Date).getTime();
    },

    setSocketId: function (serverId, clientId, sid) {
        var socs = self.sockets[serverId];
        if (!self.isset(socs)) {
            self.ackServerHeartbeat(serverId);
        }
        var connected = self.sockets[serverId].connected;
        if (!self.isset(connected[clientId])) {
            connected[clientId] = [];
        }
        var i = connected[clientId].indexOf(sid);
        if (i >= 0) {
            self.debug('warning - socket {0} already set for {1} on server {2}'.format(sid, clientId, serverId));
            return false;
        }
        connected[clientId].push(sid);
        return true;
    },

    // self.sockets = {
    //     7b80-e8yT-6969-0br9-Wero: {
    //         heartbeatTs: 7890,
    //         connected: {
    //            'd-8': [80pTew, 2ezM6],
    //            'c-9': []
    //         }
    //     }
    //     89yT-Hgw9-
    // }
    removeSocketId: function (serverId, clientId, sid) {
        var socs = self.sockets[serverId];
        if (self.isset(socs)) {
            var connected = socs.connected[clientId];
            if (self.isset(connected)) {
                var i = connected.indexOf(sid);
                if (i < 0) {
                    self.error('removeSocketId - socket {0} not connected for {1} on server {2}'.format(sid, clientId, serverId));
                    return false;
                }
                connected.splice(i, 1);
                if (connected.length <= 0) {
                    delete socs.connected[clientId];
                    return true;
                }
            } else {
                self.error('Trying to remove sid from non-existent client {1} on server {2}'.format(sid, clientId, serverId));
            }
        } else {
            self.error('Trying to remove sid {0} from non-existent server {1}'.format(sid, serverId));
        }
        return false;
    },

    getSocketIds: function (serverId, clientId) {
        var socs = self.sockets[serverId];
        if (!self.isset(socs)) {
            return [ ];
        }
        return self.getOrElse(socs.connected[clientId], [ ]);
    },
    
    isconnected: function (clientId) {
        var socs = self.sockets;
        for (var key in socs) {
            if (socs.hasOwnProperty(key)) {
                var serverId = key;
                var sids = socs[serverId].connected[clientId];
                if (sids != null && sids.length > 0) {
                    return true;
                }
            }
        }
        return false;
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
            // remove the last element (the counter) & cast to int
            var cnt = parseInt(parts.pop());
            var key = parts.join('-');
            if (!self.isset(ids[key])) {
                self.error('Error - Trying to free {0} but key {1} not found'.format(id, key));
            } else if (ids[key].available.indexOf(cnt) >= 0) {
                self.error('Error - id {0} has already been released'.format(id));
            } else {
                //self.debug('releasing key={0}, cnt={1} for reconsumption'.format(key, cnt));
                // insert key into the correct sorted position!
                var available = ids[key].available;
                for (var i = 0; i < available.length; i++) {
                    if (available[i] >= cnt) {
                        available.splice(i, 0, cnt);
                        return;
                    }
                }
                available.push(cnt);
            }
        };
    })(),

    roomTrackers: function (clientId) {
        return 'room_' + clientId;
    },
};

self = module.exports;
