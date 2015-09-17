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
        g.redis.SMEMBERS(that._cacheKeySubscribers(clientId), function (err, ret) {
            if (err) {
                console.log('Error: notify_status - ' + err);
            } else {
                for (var i = 0; i < ret.length; i++) {
                    var socs = g.getSockets(ret[i]);
                    for (var j = 0; j < socs.length; j++) {
                        var soc = socs[j];
                        if (soc.connected) {
                            var data = {
                                clientId: clientId, status: status,
                            };
                            soc.emit(that.WS_STAT, JSON.stringify(data));
                        }
                    }
                }
            }
        });
    },

    gen_token: function (clientId) {
        //var str = clientId + new Date().getTime() + Math.floor(Math.random() * 8);
        //return bcrypt.hashSync(str, 1);
        
        var token = '';
        var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (var i = 0; i < 64; i++) {
            token += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return token;
        
    },

    // TODO: Implement time-constant token validation.
    verify_token: function (clientId, token) {
        if (!g.isset(g['tokens'][clientId])) {
            // Check if the token is stored in redis / mysql
            return false;
        }
        // XXX: Need to check expiryTs
        return g['tokens'][clientId]['token'] == token;
    },

    /**
     * @return
     */
    '/api/authenticate': function (params, fn) {
        var username = params['username'],
            password = params['password'],
            type     = params['type'];
        if (!g.isset(username) || !g.isset(password) || !g.isset(type)) {
            fn(self._error(1, 'Missing username, password, or login type'));
            return;
        }
        // node-mysql library automatically performs escaping to prevent sql injections
        var select, update;
        if (type == 'c') {
            select = "SELECT pk_User AS pk, password FROM User WHERE email='{0}'";
            update = "UPDATE User SET api_token='{0}' WHERE pk_User={1}";
        } else if (type == 'd') {
            // drivers
            select = "SELECT pk_Driver AS pk, password FROM Driver WHERE email='{0}'";
            update = "UPDATE Driver SET api_token='{0}' WHERE pk_Driver={1}";
        } else if (type == 'a') { // admin
            select = "SELECT pk_admin_User AS pk, password FROM admin_User WHERE username='{0}'";
            update = "UPDATE admin_User SET api_token='{0}' WHERE pk_admin_User={1}";
        } else if (type == 'b') { // back-end
            select = "SELECT pk_api_User AS pk, api_password AS password FROM api_User WHERE api_username='{0}'";
            update = "UPDATE api_User SET api_token='{0}' WHERE pk_api_User={1}";
        } else {
            fn(self._error(1, 'Login type ' + type + ' not recognized'));
            return;
        }
        console.log('Fetching authentication credentials');
        g.mysql.exec(select.format(username), function (res) {
            if (res == null) {
                fn(self._error(1, 'Database error during authentication'));
            } else if (res.length > 0 && !g.empty(res[0]['pk']) && !g.empty(res[0]['password'])) {
                var pk = res[0]['pk'];
                var clientId = '{0}{1}'.format(type, pk); // c500
                var hash = res[0]['password'];
                // Async compare using bcyrpt
                bcrypt.compare(password, hash, function (err, res) {
                    if (err) {
                        // error with bcrypt
                        var msg = 'Error with bcrypt - ' + err;
                        console.log(msg);
                        fn(self._error(1, msg));
                    } else if (res) {
                        // Good - check if an API token has already been generated for another user instance
                        if (g.tokens[clientId] != null) {
                            fn(self._success({
                                uid: clientId, token: g.tokens[clientId], expiryTs: -1  
                            }));
                            return;
                        }
                        // If none exist, generate a new one
                        var token = self.gen_token(clientId);
                        var ret = {
                            uid: clientId, token: token, expiryTs: -1,
                        };
                        // Update database
                        g.mysql.exec(update.format(token, pk), function (res) {
                            if (res == null) {
                                fn(that._error(1, 'Error writing token to database'));
                            } else {
                                console.log('Assigned {0} access token {1}'.format(clientId, token));
                                g.tokens[clientId] = ret;
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
        var clientId = params['uid'];
        fn(that._success('Hello, ' + clientId + '!'));
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

    '/api/push': function (params, fn) {console.log('here');
        var rid  = g.get(params, 'rid', null);
            from = params.from,
            to   = params.to,
            subject = params.subject,
            body = params.body;
        if (!g.isset(to) || !g.isset(subject) || !g.isset(body)) {
            fn(self._error(1, 'Missing to, subject, or body parameter(s)'));
            return;
        }
        var p = {
            rid: rid, from: from, to: to, subject: subject, body: body
        };
        var recipient = JSON.parse(to);
        if (recipient instanceof Array) {
            // Enqueue push notification then schedule a pop
            for (var i = 0; i < recipient.length; i++) {
                p.to = recipient[i];
                console.log("pushing msg to " + p.to);
                push.queue(String(recipient[i]), JSON.stringify(p));
            }
            fn(self._success('ok'));
        } else if ('*' === recipient) {
            fn(self._error(1, 'Error - global pushes currently not supported'));
        } else {
            g['redis'].SMEMBERS(self._cacheKeyGroup(recipient), function (err, ret) {
                if (err != null) {
                    console.log('Error getting members for ' + that._cacheKeyGroup(recipient) + ' - ' + err);
                } else {
                    for (var i = 0; i < ret.length; i++) {
                        push.queue(String(ret[i]), JSON.stringify(p));
                    }
                    fn(that._success('ok'));
                }
            }); // g['redis'].SMEMBERS
        }
    },

    /** Geotracking **/
  
    WS_LOC: 'loc',
    
    _cacheKeyLatLng: function (uid) {
        return 'loc_' + uid + '.latlng';
    },
    
    _cacheKeySubscribers: function (uid) {
        return 'loc_' + uid + '.subscribers';
    },

    /**
     * Get (one time) the location of one or more clients.
     */
    '/api/gloc': function (params, fn) {
        // TODO
        fn(that._error(1, 'This API is currently not implemented.'));
    },
  
    /**
     * Update GPS location.
     * @param uid The user identifier of the client (customer or driver) whose
     *            location is to be updated. 
     * @param lng Longitude.
     * @param lat Latitude.
     */
    '/api/uloc': function (params, fn) {// check to see if the user even supplied a callback function!
        var uid = params['uid'],
            lat = params['lat'],
            lng = params['lng'],
            obj = {
                'lat': lat, 'lng': lng,
            };
        // Update location in cache.
        g['redis'].SET(that._cacheKeyLatLng(uid), JSON.stringify(obj), function (err, ret) {
            if (err != null) {
                fn(that._error(1, err));
            } else {
                fn(that._success(''));
                // Then push loc update to all subscribers.
                g['redis'].SMEMBERS(that._cacheKeySubscribers(uid), function (err, ret) {
                    if (err != null) {
                        console.log('Error getting subscribers for ' + that._cacheKeySubscribers(uid) + ' - ' + err);
                    } else {
                        for (var i = 0; i < ret.length; i++) {
                            var socs = g.getSockets(ret[i]);
                            for (var j = 0; j < socs.length; j++) {
                                if (soc.connected) {
                                    obj.clientId = uid;
                                    soc.emit('loc', JSON.stringify(obj));
                                }
                            }
                        }
                    }
                }); // g['redis'].SMEMBERS
            } 
        }); // g['redis'].SET
    },

    '/api/track': function (params, fn) {
        var uid = params['uid'],
            clientId = params['client_id']; // clientId not client_id (again must standardize!)
        g['redis'].SADD(that._cacheKeySubscribers(clientId), uid, function (err, ret) {
            if (err != null) {
                fn(that._error(1, err));
            } else {
                var cSocs = g.getSockets(clientId);
                fn(that._success({
                    'clientId': clientId, connected: (cSocs.length > 0),
                }));
                // Then if there's any location data available, immediately send it.
                // XXX: Do not send stale location data. Maybe only send if client is online?
                if (g.empty(cSocs)) {
                    return;
                }
                g['redis'].GET(that._cacheKeyLatLng(clientId), function (err, ret) {
                    if (err != null) {
                        console.log('Error fetching ' + that._cacheKeyLatLng(clientId) + ' - ' + err);
                    } else if (!g.empty(ret)) {
                        var socs = g.getSockets(uid);
                        for (var i = 0; i < socs.length; i++) {
                            var soc = socs[i];
                            if (soc.connected) {
                                var obj = JSON.parse(ret);
                                obj.clientId = clientId;
                                soc.emit('loc', JSON.stringify(obj));
                            }
                        }
                    }
                }); // g['redis'].GET
            }
        }); // g['redis'].SADD
    },
};
that = module.exports;
self = module.exports;