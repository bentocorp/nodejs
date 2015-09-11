/**
 * @author
 * @copyright
 */
var g    = require('./global.js'),
    push = require('./push.js'),
    url  = require('url'),
    bcrypt = require('bcrypt');
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
                    var soc = g.getSocket(ret[i]);
                    if (!g.empty(soc) && soc.connected) {
                        var data = {
                            'clientId': clientId,
                            'status': status,
                        }
                        soc.emit(that.WS_STAT, JSON.stringify(data));
                    }
                }
            }
        });
    },

    // TODO: Make stronger
    gen_token: function (uid) {
        //var str = uid + new Date().getTime() + Math.floor(Math.random() * 8);
        //return bcrypt.hashSync(str, 1);
        var token = '';
        var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (var i = 0; i < 64; i++) {
            token += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return token;
    },

    // TODO: Implement time-constant token validation.
    verify_token: function (uid, token) {
        if (!g.isset(g['tokens'][uid])) {
            // Check if the token is stored in redis / mysql
            return false;
        }
        // XXX: Need to check expiryTs
        return g['tokens'][uid]['token'] === token;
    },

    /**
     * @return
     */
    '/api/authenticate': function (params, fn) {
        //fn(that._success());
        if (!g.isset(params['username']) || !g.isset(params['password'])) {
            fn(that._error(1, 'Missing username or password'));
            return;
        }
        // TODO: protect against sql injection attacks.
        var sql = "SELECT password FROM User WHERE email='" + params['username'] + "'";
        console.log('Retrieving authentication information for ' + params['uid']);
        g.mysql.exec(sql, function (res) {
            if (res == null) {
                fn(that._error(1, 'Database error during authentication'));
            } else if (res.length > 0 && !g.empty(res[0]['password'])) {
                var hash = res[0]['password'];
                // Async compare using bcyrpt
                bcrypt.compare(params['password'], hash, function (err, res) {
                    if (err) {
                        // error with bcrypt
                        var msg = 'Error with bcrypt - ' + err;
                        console.log(msg);
                        fn(that._error(1, msg));
                    } else if (res) {
                        // Good - generate API token here
                        var ret = {
                            'token': that.gen_token(params['uid']), 'expiryTs': -1,
                        };
                        // Update database
                        g.mysql.exec("UPDATE User SET api_token='" + ret['token'] + "'WHERE email='" + params['username'] + "'", function (res) {
                            if (res == null) {
                                fn(that._error(1, 'Error writing token to database'));
                            } else {
                                g['tokens'][params['uid']] = ret;
                                fn(that._success(ret));
                            }
                        });
                    } else {
                        fn(that.error('bad_auth'));
                    }
                });
            } else {
                // This makes the server vulnerable to scraping attacks (testing only)
                fn(that._error(1, 'database query came back empty; user not found'));
            }
        });
    },

    '/api/greet': function (params, fn) {
        var clientId = params['uid'];
        fn(that._success('Hello, ' + clientId + '!'));
    },
  
    /** Push notifications **/ 

    '/api/push': function (params, fn) {
        if (!g.isset(params['target']) || !g.isset(params['subject']) || !g.isset(params['body'])) {
            fn(that._error(1, 'Missing target, subject, or body paramter'));
        }
        var target = JSON.parse(params['target']);
        if (target instanceof Array) {
            // Push notification to queue and schedule a pop.
            for (var i = 0; i < target.length; i++) {
            var p = {
                'origin' : params['uid'],
                'target' : target[i],
                'subject': params['subject'],
                'body'   : params['body'],
            };
            push.queue(target[i]+'', JSON.stringify(p));
        }
    }
    // TODO: Support * and group notifications.
    fn(that._success(''));
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
                            var soc = g.getSocket(ret[i]);
                            if (!g.empty(soc)) {
                                obj.clientId = uid;
                                soc.emit('loc', JSON.stringify(obj));
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
                var cSoc = g.getSocket(clientId);
                fn(that._success({
                    'clientId': clientId, connected: g.empty(cSoc) ? false : cSoc.connected,
                }));
                // Then if there's any location data available, immediately send it.
                // XXX: Do not send stale location data. Maybe only send if client is online?
                if (g.empty(cSoc) || !cSoc.connected) {
                    return;
                }
                g['redis'].GET(that._cacheKeyLatLng(clientId), function (err, ret) {
                    if (err != null) {
                        console.log('Error fetching ' + that._cacheKeyLatLng(clientId) + ' - ' + err);
                    } else if (!g.empty(ret)) {
                        var soc = g.getSocket(uid);
                        if (g.isset(soc)) {
                            var obj = JSON.parse(ret);
                            obj.clientId = clientId;
                            soc.emit('loc', JSON.stringify(obj));
                        }
                    }
                }); // g['redis'].GET
            }
        }); // g['redis'].SADD
    },


};
that = module.exports;
