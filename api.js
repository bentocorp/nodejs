/**
 * @author
 * @copyright
 */
var g    = require('./global.js'),
    push = require('./push.js'),
    url  = require('url'),
    bcrypt = require('bcrypt');
var self;
var that;
module.exports = {

    /**
     * API response object.
     * @param code (number) 0 - success, otherwise error
     *        msg  (string) Empty if success, otherwise an error message
     *        ret  (?)      The return value (can be a primitive or an object)
     */
    _res: function (code, msg, ret) {
        return JSON.stringify({
            'code': code, 'msg': msg, 'ret': ret,
        });
    },
  
    _success: function (ret) {
        return that._res(0, '', ret);
    },
  
    _error: function (code, msg) {
        return that._res(code, msg, null);
    },

    /* Errors */

    _error_codes: {
        'generic'  : [101, 'Problem invoking API function'],
        'not_found': [102, 'Not found'],
        'malformed_request': [103, 'Malformed request'],
        'bad_auth' : [104, 'Bad authentication credentials'],
    },

    error: function (name) {
        return that._error(that._error_codes[name][0], that._error_codes[name][1]);
    },
  
    _requestFilters: {
        '/api/push': [],
    },
  
    is_valid: function (req) {
        var urlParts = url.parse(req.url, true);
        var filters = that._requestFilters[urlParts.pathname];
        if (g.isset(filters)) {
            for (var i = 0; i < filters.length; i++) {
                //if (that[filters[i]](req)) {
                //    return false;
                //}
            }
        }
        return true;
    },

    WS_STAT: 'stat',

    notify_status: function (clientId, status) {
        var data = {
            clientId: clientId, status: status,
        };
        g.io.sockets.in(g.roomTrackers(clientId)).emit(self.WS_STAT, JSON.stringify(data));
    },

    gen_token: function (clientId) {
        //var str = clientId + new Date().getTime() + Math.floor(Math.random() * 8);
        //return bcrypt.hashSync(str, 1);
        var rpart = "";
        var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (var i = 0; i < 8; i++) {
            rpart += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        // For now, does not expire
        return clientId + "-0-" + rpart;
    },

    // TODO - Implement time-constant token validation
    verify_token: function (clientId, token) {
        if (!g.isset(g['tokens'][clientId])) {
            g.debug('verify_token - not set for {0}'.format(clientId));
            // Check if the token is stored in redis / mysql
            return false;
        }
        var persisted = g['tokens'][clientId];
        console.log('verify_token - comparing provided ' + token + ' with persisted ' + persisted);
        // XXX - Need to check expiryTs
        return persisted == token;
    },

    '/api/authenticate': function (params, fn) {
        var username = params['username'],
            password = params['password'],
            type     = params['type'], // customer, driver, admin, or system
            table    = g.mysql[type];
        if (!g.isset(username) || !g.isset(password) || !g.isset(type)) {
            fn(self._error(1, 'Missing username, password, or login type'));
            return;
        }
        if (!g.isset(table)) {
            g.error('Error - unrecognized type {0}'.format(type));
            fn(self._error(1, 'Login type ' + type + ' not recognized'));
            return;
        }
        g.debug('Fetching authentication credentials');
        table.getAuth(username, function (res) {
            if (res == null) {
                fn(self._error(1, 'Database error during authentication'));
            } else if (res.length > 0 && !g.empty(res[0]['pk']) && !g.empty(res[0]['password'])) {
                var pk = res[0]['pk'];
                var clientId = '{0}-{1}'.format(type.substring(0, 1), pk); // c-500
                var hash = res[0]['password'];
                // Async compare using bcrypt
                bcrypt.compare(password, hash, function (err, res) {
                    if (err) {
                        // error with bcrypt
                        var msg = 'Error with bcrypt - ' + err;
                        fn(self._error(1, msg));
                    } else if (res) {
                        // Good - check if an API token has already been generated for another user instance
                        if (g.tokens[clientId] != null) {
                            fn(self._success({ token: g.tokens[clientId] }));
                            return;
                        }
                        // If none exist, generate a new one
                        var token = self.gen_token(clientId); // d-890-0yH5ob94
                        var ret = { token: token };
                        // Write token to database
                        table.updateToken(pk, token, function (res) {
                            if (res == null) {
                                fn(that._error(1, 'Error writing token to database'));
                            } else {
                                g.debug('Assigned {0} access token {1}'.format(clientId, token));
                                g.tokens[clientId] = token;
                                fn(that._success(ret));
                            }
                        });
                    } else {
                        fn(that.error('bad_auth'));
                    }
                });
            } else {
                // This makes the server vulnerable to scraping attacks (testing only)
                fn(that._error(1, 'database query came back empty; user ' + username + ' not found'));
            }
        });
    },

    '/api/greet': function (params, fn) {
        console.log('connected - ' + Object.keys(g.io.sockets.connected));
        var clientId = params['uid'];
        fn(that._success('Hello, ' + clientId + '!'));
    },

    '/api/test': function (params, fn) {
        fn(self._success("ok"));
    },

    '/api/connected': function (params, fn) {
        var ret = g.isconnected(params['clientId']);
        fn(self._success(ret));
    },
  
    /** Push notifications **/
    _cacheKeyGroup: function (name) {
        return 'group_' + name;
    },

    // XXX: Guard against cross-user modification
    '/api/modgrp': function (params, fn) {
        var cmd = params['cmd'], uid = params['uid'], group = params['group'];
        if (!g.isset(cmd) || !g.isset(uid) || !g.isset(group)) {
            fn(self._error(1, 'Error - cmd, uid, or group parameter not found'));
        } else {
            switch (cmd) {
                case 'a':
                    g['redis'].SADD(self._cacheKeyGroup(group), uid, function (err, ret) {
                        if (err != null) {
                            fn(self._error(1, err));
                        } else {
                            fn(self._success(null));    
                        }
                    });
                case 'd':
                case 'D':
                    // Delete a group
                    break;
                default:
                    fn(self._error(1, 'Error - command ' + cmd + ' not supported'));
            }
        }
    },

    // Ready for push data via WebSocket
    '/api/ready': function (params, fn) {
        var uid = params['uid'],
            sid = params['sid'];
        if (!g.isset(sid)) {
            throw 'Error - parameter sid (socket identifier) not found; make sure /api/ready is called via WebSocket';
        }
        var soc = g.io.sockets.connected[sid];
        if (!g.isset(soc)) {
            fn(self._error(1, "Something is very wrong - socket object doesn't exist"));
        } else {
            soc.ready = true;
            soc.join(String(uid));
            g.debug('{0} joined room(s) {1}'.format(soc.name, uid));
            // If client is admin, automatically add to "atlas" group
            if (uid.split('-')[0] == 'a') {
                g.debug('Trying to automatically add {0} to "atlas" group'.format(soc.name));
                // TODO - Groups shouldn't be lazily loaded
                //soc.join('atlas');
                // persist client to group on redis so push notifications are properly queued
                g.redis.SADD(self._cacheKeyGroup('atlas'), uid, function (err, ret) {
                    if (err != null) {
                        g.error('Error - Problem adding client {0} to group "atlas"'.format(uid));
                    } else {
                        g.debug('Added {0} to group "atlas"'.format(uid));
                    }
                });
            }
            g['redis'].SMEMBERS(self._cacheKeyTrackList(uid), function (err, ret) {
                if (err) {
                    fn(self._error(1, 'Error getting subscriptions for ' + self._cacheKeyTrackList(uid) + ' - ' + err));
                } else if (g.isset(soc)) {
                    var rooms = [];
                    for (var i = 0; i < ret.length; i++) {
                        var room = g.roomTrackers(ret[i]);
                        rooms.push(room);
                        soc.join(room);
                    }
                    g.debug('{0} joined room(s) {1}'.format(soc.name, rooms.join(", ")));
                    fn(self._success('ok'));
                }
            });
            push.flush(uid);
        }
    },

    '/api/push': function (params, fn) {
        var rid  = g.getOrElse(params['rid'], null);
            from = params.from,
            to   = params.to,
            subject = params.subject,
            body = params.body;
        if (!g.isset(to) || !g.isset(subject) || !g.isset(body)) {
            if (g.isset(fn)) fn(self._error(1, 'Missing to, subject, or body parameter(s)'));
            return;
        }
        var timestamp = g.getOrElse(params['timestamp'], new Date().getTime());
        var p = {
            rid: rid, from: from, to: to, subject: subject, body: JSON.parse(body), timestamp: timestamp,
        };
        console.log(typeof to + "(" + to + ")");
        var recipient = JSON.parse(to);
        if (recipient instanceof Array) {
            // Enqueue push notification then schedule a pop
            for (var i = 0; i < recipient.length; i++) {
                p.to = recipient[i];
                push.queue(String(recipient[i]), JSON.stringify(p));
            }
            if (g.isset(fn)) fn(self._success('ok'));
        } else if ('*' === recipient) {
            if (g.isset(fn)) fn(self._error(1, 'Error - global pushes currently not supported'));
        } else {
            g['redis'].SMEMBERS(self._cacheKeyGroup(recipient), function (err, ret) {
                if (err != null) {
                    g.error('Error getting members for ' + that._cacheKeyGroup(recipient) + ' - ' + err);
                } else {
                    for (var i = 0; i < ret.length; i++) {
                        push.queue(String(ret[i]), JSON.stringify(p));
                    }
                    if (g.isset(fn)) fn(that._success('ok'));
                }
            }); // g['redis'].SMEMBERS
        }
    },

    /* Tracking */
  
    WS_LOC: 'loc',

    _cacheKeyLatLng: function (uid) {
        return uid + '_latlng';
    },

    _cacheKeySubscribers: function (uid) {
        return uid + '_subscribers';
    },
    
    _cacheKeyTrackList: function (uid) {
        // {0}_ does't work here!
        return uid + '_trackList';
    },

    '/api/gloc': function (params, fn) {
        var uid = params['uid'],
            clientId = params['clientId'];
        g['redis'].GET(self._cacheKeyLatLng(clientId), function (err, ret) {
            if (err) {
                fn(self._error(1, 'Error fetching ' + self._cacheKeyLatLng(clientId) + ' - ' + err));
            } else {
                var obj = null;
                if (!g.empty(ret)) {
                    obj = JSON.parse(ret);
                    obj.clientId = clientId;
                }
                fn(self._success(obj));
            }
        });
    },
  
    '/api/uloc': function (params, fn) {
        var uid = params['uid'],
            lat = params['lat'],
            lng = params['lng'],
            obj = {
                'lat': lat, 'lng': lng,
            };
        // First persist coordinates to redis
        g['redis'].SET(self._cacheKeyLatLng(uid), JSON.stringify(obj), function (err, ret) {
            if (err) {
                fn(self._error(1, err));
            } else {
                fn(self._success("ok"));
                // Then push loc update to all subscribers
                obj.clientId = uid;
                g.io.sockets.in(g.roomTrackers(uid)).emit('loc', JSON.stringify(obj));
            } 
        }); // g['redis'].SET
    },

    '/api/track': function (params, fn) {
        var uid = params['uid'],
            clientId = params['clientId'];
        if (!g.isset(uid) || !g.isset(clientId)) {
            fn(self._error(1, 'Error - missing paramters uid or clientId'));
            return;
        }
        // TODO - add uid to client's subscribers list also
        //console.log('SADD ' + self._cacheKeyTrackList(uid) + ' ' + clientId);
        g['redis'].SADD(self._cacheKeyTrackList(uid), clientId, function (err, ret) {
            if (err) {
                fn(self._error(1, err));
            } else {
                g.nio.broadcastTrack(uid, clientId);
                var connected = g.isconnected(clientId);
                fn(self._success({
                    'clientId': clientId, 'connected': connected,
                }));
                /*
                // Then if there's any location data available, immediately send it.
                // XXX: Do not send stale location data. Maybe only send if client is online?
                if (!connected) {
                    return;
                }
                */
            }
        }); // g['redis'].SADD
    },

    '/api/untrack': function (params, fn) {
        fn(self._error(1, '/api/untrack not implemented yet =('));
    },
};
that = module.exports;
self = module.exports;